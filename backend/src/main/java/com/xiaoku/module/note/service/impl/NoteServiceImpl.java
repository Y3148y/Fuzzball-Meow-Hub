package com.xiaoku.module.note.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.exception.BizException;
import com.xiaoku.module.moderation.TextModeration;
import com.xiaoku.module.notification.service.NotificationService;
import com.xiaoku.module.topic.service.TopicRelationService;
import com.xiaoku.common.result.ErrorCodeEnum;
import com.xiaoku.common.storage.ImageStorage;
import com.xiaoku.common.support.NoteIdBloomFilter;
import com.xiaoku.module.comment.entity.CommentEntity;
import com.xiaoku.module.comment.entity.CommentLikeEntity;
import com.xiaoku.module.comment.mapper.CommentLikeMapper;
import com.xiaoku.module.comment.mapper.CommentMapper;
import com.xiaoku.module.note.converter.NoteConverter;
import com.xiaoku.module.note.dto.NotePublishDTO;
import com.xiaoku.module.note.entity.NoteCollectEntity;
import com.xiaoku.module.note.entity.NoteEntity;
import com.xiaoku.module.note.entity.NoteImageEntity;
import com.xiaoku.module.note.entity.NoteLikeEntity;
import com.xiaoku.module.note.mapper.NoteCollectMapper;
import com.xiaoku.module.note.mapper.NoteImageMapper;
import com.xiaoku.module.note.mapper.NoteLikeMapper;
import com.xiaoku.module.note.mapper.NoteMapper;
import com.xiaoku.module.note.service.NoteQueryService;
import com.xiaoku.module.note.service.NoteService;
import com.xiaoku.common.storage.VideoStorage;
import com.xiaoku.module.note.support.NoteCounterStore;
import com.xiaoku.module.note.vo.NoteVO;
import com.xiaoku.module.search.event.NoteEventDTO;
import com.xiaoku.module.user.service.UserQueryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.multipart.MultipartFile;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

@Slf4j
@Service
@RequiredArgsConstructor
public class NoteServiceImpl implements NoteService {

    /** 单篇笔记图片上限，与 NOTE_IMAGE_LIMIT_EXCEED 的文案保持一致 */
    private static final int MAX_IMAGE_COUNT = 9;

    private static final int TYPE_GRAPHICAL = 1;
    private static final int TYPE_VIDEO = 2;

    private static final int STATUS_PUBLISHED = 1;
    private static final int STATUS_TAKEN_DOWN = 2;

    private final NoteMapper noteMapper;
    private final NoteImageMapper noteImageMapper;
    private final NoteLikeMapper noteLikeMapper;
    private final NoteCollectMapper noteCollectMapper;
    private final CommentMapper commentMapper;
    private final CommentLikeMapper commentLikeMapper;
    private final NoteQueryService noteQueryService;
    private final UserQueryService userQueryService;
    private final ImageStorage imageStorage;
    private final VideoStorage videoStorage;
    private final KafkaTemplate<String, Object> kafkaTemplate;
    private final NoteIdBloomFilter bloomFilter;
    private final NoteCounterStore counterStore;
    private final TextModeration textModeration;
    private final TopicRelationService topicRelationService;
    private final NotificationService notificationService;

    @Value("${xiaoku.kafka.note-topic}")
    private String noteEventTopic;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public NoteVO publish(NotePublishDTO dto) {
        Long userId = UserContextHolder.requireUserId();
        PublishParams params = validatePublishParams(dto, true);
        NoteEntity note = new NoteEntity();
        note.setUserId(userId);
        note.setType(params.type());
        note.setTitle(dto.getTitle().trim());
        note.setContent(dto.getContent().trim());
        note.setVideoUrl(dto.getVideoUrl());
        // 封面缺省取第一张图，省得前端每篇都单独上传一张
        note.setCover(params.images().isEmpty() ? null : params.images().get(0));
        note.setStatus(1);
        noteMapper.insert(note);
        // 提前置位（事务提交前）：假阳性只多查一次库，「漏置位 = 详情 404」才是要命的。
        // 详见 NoteIdBloomFilter 的类注释
        bloomFilter.add(note.getId());

        for (int i = 0; i < params.images().size(); i++) {
            NoteImageEntity image = new NoteImageEntity();
            image.setNoteId(note.getId());
            image.setUrl(params.images().get(i));
            image.setSort(i);
            noteImageMapper.insert(image);
        }

log.info("笔记发布成功 noteId={} userId={} images={}", note.getId(), userId, params.images().size());

        // 稀缺：规划 ES 索引的异步同步。必须在 afterCommit 发送而不是在事务内直接发，
        // 否则「消息进了 Kafka、事务却回滚」会产生索引里有、库里没有的幽灵文档。
        // 发送是异步的且失败只记日志：搜索索引可被 /api/search/reindex 一键重建，不值得拖成功接口
        //
        // ⚠️ **这行之前被误删过**：P17 插入「话题关系行」时，编辑器把它当成了
        // 上一段注释的延续，一起删掉了。结果是发布不再发 ES 事件，而
        // **接口照常返回 200**，契约里的「发布后经 Kafka 异步入搜索索引」
        // 才红 —— 一条与话题毫无关系的断言替你抓到的话题改动出的问题。
        registerAfterCommit(NoteEventDTO.ACTION_PUBLISH, ofEventNote(note, params, dto, STATUS_PUBLISHED));

        // 话题/提及关系行：正文是唯一事实来源，后端自己从 title+content 解析。
        // 放在写完 note/note_image 之后 —— 关系行需要 noteId，而 noteId 到这里才有。
        topicRelationService.replaceRelations(note, note.getTitle(), note.getContent());
        // 刚发布的笔记必然没有点赞/收藏/关注作者（自己不能关注自己），三者都是 false
        return NoteConverter.toVO(note, userQueryService.getUserVO(userId), params.images(), false, false, false);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public NoteVO update(Long noteId, NotePublishDTO dto) {
        Long userId = UserContextHolder.requireUserId();
        NoteEntity note = noteMapper.selectById(noteId);
        // 别人的笔记一律按「不存在」处理（和评论删除同一套防探测策略）：
        // 编辑入口不暴露「这篇笔记是否存在」给非作者
        if (note == null || !userId.equals(note.getUserId())) {
            throw new BizException(ErrorCodeEnum.NOTE_NOT_FOUND);
        }
        // P21 起 update 也要求至少一张图（原来传 false，P10 刻意保留「编辑可清空图片」）。
        // 改这个的原因不是「想收紧」，而是**无图笔记会真的把前端打坏**：
        //   ① 详情页 .col-media 渲染成空块，再叠加 :has() 单栏兜底 → 布局看着是乱的；
        //   ② 列表卡拿吉祥物兜底当封面，宽高比被写成吉祥物的比例 → 卡片大小与其它卡不符。
        // 这两条 2026-10-08 手测都撞到了（5 篇 P6 遗留的无图笔记）。
        // 小红书发帖与编辑都要求至少一张图，这里对齐它 ——
        // 让「无图笔记」这个形态压根不存在，比事后给前端加兜底分支更省事。
        PublishParams params = validatePublishParams(dto, true);

        // 用 LambdaUpdateWrapper 显式 set 而不是 updateById：全项目配了
        // update-strategy not_null，updateById 会把「清空的字段」（cover / videoUrl）
        // 当 null 跳过，导致旧值残留。wrapper 的 set 连 null 一起写，语义才是完整覆盖。
        noteMapper.update(null, Wrappers.<NoteEntity>lambdaUpdate()
                .eq(NoteEntity::getId, noteId)
                .set(NoteEntity::getType, params.type())
                .set(NoteEntity::getTitle, dto.getTitle().trim())
                .set(NoteEntity::getContent, dto.getContent().trim())
                .set(NoteEntity::getVideoUrl, dto.getVideoUrl())
                .set(NoteEntity::getCover, params.images().isEmpty() ? null : params.images().get(0))
                .set(NoteEntity::getUpdateTime, LocalDateTime.now()));

        // 图片策略：删旧重插。增删/换序都用「整表重建」表达，不做逐张 diff——
        // 编辑是低频操作，diff 的复杂度不值得省那点 IO，也回避「删了没插、插了没删」
        // 的中间态
        noteImageMapper.delete(Wrappers.<NoteImageEntity>lambdaQuery()
                .eq(NoteImageEntity::getNoteId, noteId));
        for (int i = 0; i < params.images().size(); i++) {
            NoteImageEntity image = new NoteImageEntity();
            image.setNoteId(noteId);
            image.setUrl(params.images().get(i));
            image.setSort(i);
            noteImageMapper.insert(image);
        }

        log.info("笔记更新成功 noteId={} userId={}", noteId, userId);
        // 话题/提及全量替换：编辑本来就是全量覆盖语义，关系行跟着换。
        // 不做增量 diff —— 一篇最多 5 话题 10 提及，删了重插很便宜，
        // 而增量留下的「改了正文还挂着旧话题」残留更难查
        topicRelationService.replaceRelations(note, dto.getTitle().trim(), dto.getContent().trim());
        // 编辑不会让一篇笔记「重新上热搜」：已下架的继续发 UNPUBLISH（确保索引里没有），
        // 正常的才带新标题/正文 re-upsert
        int curStatus = note.getStatus() == null ? STATUS_PUBLISHED : note.getStatus();
        String action = curStatus == STATUS_PUBLISHED
                ? NoteEventDTO.ACTION_PUBLISH
                : NoteEventDTO.ACTION_UNPUBLISH;
        registerAfterCommit(action, ofEventNote(note, params, dto, curStatus));
        return noteQueryService.getDetail(noteId);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public NoteVO changeStatus(Long noteId, Integer status) {
        requireValidStatus(status);
        Long userId = UserContextHolder.requireUserId();
        NoteEntity note = noteMapper.selectById(noteId);
        if (note == null || !userId.equals(note.getUserId())) {
            throw new BizException(ErrorCodeEnum.NOTE_NOT_FOUND);
        }
        applyStatusChange(note, status);
        return noteQueryService.getDetail(noteId);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void forceChangeStatus(Long noteId, Integer status) {
        requireValidStatus(status);
        NoteEntity note = noteMapper.selectById(noteId);
        // 运营看到的是「这篇笔记」而不是「不存在」—— 与作者侧的防探测策略相反：
        // 举报处置时运营本来就知道对象是谁，没有理由装作看不见
        if (note == null) {
            throw new BizException(ErrorCodeEnum.NOTE_NOT_FOUND);
        }
        applyStatusChange(note, status);
        log.info("运营强制变更笔记状态 noteId={} status={}", noteId, status);
    }

    private void requireValidStatus(Integer status) {
        if (status == null || (status != STATUS_PUBLISHED && status != STATUS_TAKEN_DOWN)) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "状态只能是 1（发布）或 2（下架）");
        }
    }

    /**
     * 状态变更的共同实现：更新列 + 发 Kafka 事件。
     *
     * <p>作者自己改和运营强制改<b>必须走同一段</b>：下架要撤搜索索引，
     * 靠的是 afterCommit 发的 UNPUBLISH 事件。复制一遍 update + 事件代码的
     * 后果是「运营下架了但用户还能搜到」—— 那是一个只有运营能发现的静默不一致，
     * 测试也抓不到（普通用户根本不知道这篇笔记被下架过）。
     */
    private void applyStatusChange(NoteEntity note, Integer status) {
        Long noteId = note.getId();
        if (Objects.equals(note.getStatus(), status)) {
            // 幂等：已经是目标状态就什么都不动（拿不到「状态是几」的写接口除外），
            // 重复点按钮不产生多余事件和 update
            return;
        }

        noteMapper.update(null, Wrappers.<NoteEntity>lambdaUpdate()
                .eq(NoteEntity::getId, noteId)
                .set(NoteEntity::getStatus, status)
                .set(NoteEntity::getUpdateTime, LocalDateTime.now()));

        // 用原行拼事件，保证 createTime 与作者不变：上架后重新入索引，
        // 发布时间保持首发值，搜索结果里顺序不回退
        NoteEntity eventNote = new NoteEntity();
        eventNote.setId(noteId);
        eventNote.setUserId(note.getUserId());
        eventNote.setType(note.getType());
        eventNote.setTitle(note.getTitle());
        eventNote.setContent(note.getContent());
        eventNote.setStatus(status);
        eventNote.setCreateTime(note.getCreateTime());
        String action = status == STATUS_TAKEN_DOWN
                ? NoteEventDTO.ACTION_UNPUBLISH
                : NoteEventDTO.ACTION_PUBLISH;
        registerAfterCommit(action, eventNote);
        log.info("笔记状态变更 noteId={} userId={} status={}", noteId, note.getUserId(), status);
    }

    @Override
    public String uploadImage(MultipartFile file) {
        return imageStorage.store(file);
    }

    @Override
    public String uploadVideo(MultipartFile file) {
        return videoStorage.store(file);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void delete(Long noteId) {
        Long userId = UserContextHolder.requireUserId();
        NoteEntity note = noteMapper.selectById(noteId);
        // 别人的笔记一律按「不存在」处理（防探测），和 update / changeStatus / 评论删除同一套策略
        if (note == null || !userId.equals(note.getUserId())) {
            throw new BizException(ErrorCodeEnum.NOTE_NOT_FOUND);
        }
        deleteCascade(noteId, userId);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void deleteAsAdmin(Long noteId) {
        NoteEntity note = noteMapper.selectById(noteId);
        if (note == null) {
            throw new BizException(ErrorCodeEnum.NOTE_NOT_FOUND);
        }
        deleteCascade(noteId, note.getUserId());
        log.warn("运营强制删除笔记 noteId={} authorId={}", noteId, note.getUserId());
    }

    /**
     * 删除的级联实现。运营删除与作者删除<b>必须走同一段</b>：
     * 评论、点赞/收藏关系、图片、话题/提及关系行、Redis 计数键、
     * 以及 afterCommit 的 ES 删文档事件，少做哪一样都会留下可被看到的残留。
     */
    private void deleteCascade(Long noteId, Long userId) {

        // 先捞评论 id，再删评论点赞（comment_like 依赖 comment）→ 评论（含子树，一行 WHERE note_id 全带走）
        List<Long> commentIds = commentMapper.selectList(Wrappers.<CommentEntity>lambdaQuery()
                        .select(CommentEntity::getId)
                        .eq(CommentEntity::getNoteId, noteId))
                .stream().map(CommentEntity::getId).toList();
        if (!commentIds.isEmpty()) {
            commentLikeMapper.delete(Wrappers.<CommentLikeEntity>lambdaQuery()
                    .in(CommentLikeEntity::getCommentId, commentIds));
            commentMapper.delete(Wrappers.<CommentEntity>lambdaQuery()
                    .eq(CommentEntity::getNoteId, noteId));
        }
        noteLikeMapper.delete(Wrappers.<NoteLikeEntity>lambdaQuery().eq(NoteLikeEntity::getNoteId, noteId));
        noteCollectMapper.delete(Wrappers.<NoteCollectEntity>lambdaQuery().eq(NoteCollectEntity::getNoteId, noteId));
        noteImageMapper.delete(Wrappers.<NoteImageEntity>lambdaQuery().eq(NoteImageEntity::getNoteId, noteId));
        // 话题/提及关系行同样没有外键，删笔记必须自己清，否则会留下指向
        // 不存在笔记的孤儿关系（topic 列表会把这些笔记算进热门度）
        topicRelationService.removeRelations(noteId);
        noteMapper.deleteById(noteId);

        // Redis 计数键清掉（赞/收藏 ZSet + 待落库标记），DB 行删完不留死 key
        counterStore.removeCounters(noteId);

        // 撤掉指向这篇笔记的全部通知（P21）。按 note_id 撤而不是逐条按类型撤：
        // 通知有 7 种类型，逐一枚举必然漏掉某一类，而漏掉的那类
        // 就是作者下次会点到的死链（点进去是「笔记不存在」）。
        notificationService.retractByNoteId(noteId);

        // 事件只用 noteId：消费者按 _id 删文档，不需要标题/正文
        NoteEntity eventNote = new NoteEntity();
        eventNote.setId(noteId);
        registerAfterCommit(NoteEventDTO.ACTION_DELETE, eventNote);
        log.info("笔记已删除 noteId={} userId={} cascadeComments={}", noteId, userId, commentIds.size());
    }

    /**
     * 登记「事务提交后发笔记索引事件」。见 publish 里的说明。
     */
    private void registerAfterCommit(String action, NoteEntity note) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                sendNoteEvent(action, note);
            }
        });
    }

    private void sendNoteEvent(String action, NoteEntity note) {
        NoteEventDTO event = NoteEventDTO.builder()
                .action(action)
                .noteId(String.valueOf(note.getId()))
                .title(note.getTitle())
                .content(note.getContent())
                .type(note.getType())
                .status(note.getStatus())
                .userId(String.valueOf(note.getUserId()))
                .createTime(note.getCreateTime() == null ? null
                        : note.getCreateTime().toEpochSecond(ZoneOffset.ofHours(8)) * 1000)
                .build();
        try {
            // key=noteId：同一篇笔记的事件永远落同一分区，天然串行，杜绝并发 upsert 乱序
            kafkaTemplate.send(noteEventTopic, event.getNoteId(), event);
            log.info("已发送笔记索引事件 noteId={} action={}", event.getNoteId(), event.getAction());
        } catch (RuntimeException e) {
            log.error("笔记索引事件发送失败，可运行 POST /api/search/reindex 重建。noteId={}", event.getNoteId(), e);
        }
    }

    /**
     * 用原行 + 本轮编辑结果拼索引事件载体，createTime/status 保持「当前状态」
     * 而不是裸取 dto（dto 里没有这两个字段）。
     */
    private NoteEntity ofEventNote(NoteEntity base, PublishParams params, NotePublishDTO dto, Integer status) {
        NoteEntity eventNote = new NoteEntity();
        eventNote.setId(base.getId());
        eventNote.setUserId(base.getUserId());
        eventNote.setType(params.type());
        eventNote.setTitle(dto.getTitle().trim());
        eventNote.setContent(dto.getContent().trim());
        eventNote.setStatus(status);
        eventNote.setCreateTime(base.getCreateTime());
        return eventNote;
    }

    /**
     * {@code publish} 与 {@code update} 共用的「类型/图片/视频地址」校验。
     *
     * <p>P21 起 <b>publish 与 update 都传 {@code requireGraphicImage=true}</b>：
     * 编辑也必须至少一张图。原来 update 传 false 是 P10 的决定（理由是
     * 「编辑是全量覆盖，不让内容修订卡在创建期的规则上」），但那条理由
     * 抵不过「无图笔记会把前端打坏」这个实测事实 —— 详见 update() 里的注释。
     *
     * <p>形参留着而不是直接删成常量：将来若真出现「视频笔记换封面」
     * 之类需要放宽的路径，这个开关就是唯一要动的地方。
     */
    private PublishParams validatePublishParams(NotePublishDTO dto, boolean requireGraphicImage) {
        int type = dto.getType() == null ? TYPE_GRAPHICAL : dto.getType();
        if (type != TYPE_GRAPHICAL && type != TYPE_VIDEO) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "笔记类型只能是 1图文 或 2视频");
        }

        List<String> images = dto.getImageUrls() == null ? List.of() : dto.getImageUrls();
        if (images.size() > MAX_IMAGE_COUNT) {
            throw new BizException(ErrorCodeEnum.NOTE_IMAGE_LIMIT_EXCEED,
                    "单篇笔记最多上传 " + MAX_IMAGE_COUNT + " 张图片");
        }
        if (type == TYPE_VIDEO && (dto.getVideoUrl() == null || dto.getVideoUrl().isBlank())) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "视频笔记必须填写视频地址");
        }
        // P21 起图文笔记必须至少一张图（对齐小红书），发布与编辑都强制
        if (requireGraphicImage && type == TYPE_GRAPHICAL && images.isEmpty()) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "图文笔记必须至少上传一张图片");
        }
        // P15 内容审核：标题 + 正文。放在 validatePublishParams 里是刻意的 ——
        // publish 与 update 共用它，编辑改标题同样要过审，
        // 免得「发的时候干净、编辑时塞进去」
        textModeration.check(dto.getTitle(), TextModeration.Scene.NOTE_TITLE);
        textModeration.check(dto.getContent(), TextModeration.Scene.NOTE_CONTENT);
        images.forEach(NoteServiceImpl::checkImageUrl);
        return new PublishParams(type, images);
    }

    private record PublishParams(int type, List<String> images) {
    }

    /**
     * 只放行站内相对路径与 http(s)。
     *
     * <p>不校验的话，用户可以把 {@code javascript:alert(1)} 或 {@code data:text/html,...}
     * 存进 note_image.url，前端渲染成 img src 时就构成 XSS。
     * 允许外域 http(s) 是因为业务上要支持引用外部图床，不能一刀切。
     */
    private static void checkImageUrl(String url) {
        if (url == null || url.isBlank()) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "图片地址不能为空");
        }
        String lower = url.toLowerCase(Locale.ROOT);
        boolean ok = lower.startsWith("http://")
                || lower.startsWith("https://")
                || (url.startsWith("/") && !url.startsWith("//"));
        if (!ok) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "图片地址不合法：" + url);
        }
    }
}
