package com.xiaoku.module.note.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import com.xiaoku.module.note.vo.VideoQualityVO;
import com.xiaoku.module.note.vo.VideoUploadVO;
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
import com.xiaoku.common.util.IdListUtil;

@Slf4j
@Service
@RequiredArgsConstructor
public class NoteServiceImpl implements NoteService {

    /** 单篇笔记图片上限，与 NOTE_IMAGE_LIMIT_EXCEED 的文案保持一致 */
    private static final int MAX_IMAGE_COUNT = 9;

    /** 单篇笔记清晰度档位上限（720p + 480p 已经是最多两档，上限放宽给以后的更多档） */
    private static final int MAX_QUALITY_COUNT = 3;

    private static final int TYPE_GRAPHICAL = 1;
    private static final int TYPE_VIDEO = 2;

    private static final int STATUS_DRAFT = 0;
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
    /** 仅供 {@code VideoQualityVO.serialize/parse} 序列化清晰度 JSON；Spring 容器里全局唯一 */
    private final ObjectMapper objectMapper;

    @Value("${xiaoku.kafka.note-topic}")
    private String noteEventTopic;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public NoteVO publish(NotePublishDTO dto) {
        Long userId = UserContextHolder.requireUserId();
        // P50 草稿：status=0 走草稿路径。只有 0 是特殊取值，其它（null/1）都按发布处理，
        // 2/99 这类值不静默归一 —— 传了明确不认识的值就报错，别猜用户想要什么。
        boolean asDraft = Integer.valueOf(STATUS_DRAFT).equals(dto.getStatus());
        if (dto.getStatus() != null && !asDraft && !Integer.valueOf(STATUS_PUBLISHED).equals(dto.getStatus())) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "status 只能是 0（存草稿）或 1（发布）");
        }
        // P50：草稿允许正文为空（只写标题也存得住）；发布必须带正文。
        // 校验挪进 service 的理由同 status —— 注解是无条件生效的，两条路径没法区分。
        if (!asDraft && (dto.getContent() == null || dto.getContent().isBlank())) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "正文不能为空");
        }
        // 归一 null → ""：下游 note.setContent(.trim()) / 关系行解析都按非 null 写，
        // 草稿落空串比落 null 少一条「判空分支」—— 而少一条分支就少一个漏。
        if (dto.getContent() == null) {
            dto.setContent("");
        }
        // 草稿允许无图（用户存的是没做完的东西）；发布时（0→1）才强制补图。
        // 注意 type=2 的 videoUrl 校验与这个开关无关（validatePublishParams 里独立判）。
        PublishParams params = validatePublishParams(dto, !asDraft);
        NoteEntity note = new NoteEntity();
        note.setUserId(userId);
        note.setType(params.type());
        note.setTitle(dto.getTitle().trim());
        note.setContent(dto.getContent().trim());
        note.setVideoUrl(dto.getVideoUrl());
        // P48：多码率档位随发布一起落库（null = 单码率/图文）。
        // 序列化失败会静默落 null（单码率播放语义），不会让发布失败 ——
        // 它是展示字段，不值得为它回滚整个事务。
        note.setVideoQualities(VideoQualityVO.serialize(objectMapper, params.qualities()));
        // 封面缺省取第一张图，省得前端每篇都单独上传一张
        //
        // ⚠️ **视频笔记必须从 videoUrl 推导封面**（P33）：视频没有 note_image 行，
        // 所以下面那行对视频恒为 null —— 而 `cover` 是**首页瀑布流 / 搜索 / 收藏夹**
        // 唯一的图来源，于是视频笔记在所有列表里都是一张**空白卡**。
        //
        // 不新建一个 videoCover 字段的理由：那些地方读的都是 cover，
        // 让它们各自判断「type==2 就去算封面」要改十几个 VO 与前端分支，
        // 而封面**本来就是 cover 这个字段该有的东西** ——
        // P19 当时留空只是因为「还没想清楚视频的封面从哪来」。
        //
        // P48 改走 coverOf（带磁盘存在性检查）而不是裸字符串推导：
        // 降级路径（没转码成功）没有封面文件，裸推导会推出一个 404 的假封面 ——
        // 返回 null 让列表卡落到吉祥物兜底，是「空白卡」的正确形态。
        String cover = !params.images().isEmpty() ? params.images().get(0)
                : videoStorage.coverOf(dto.getVideoUrl());
        note.setCover(cover);
        // P50：草稿落 status=0。下游全是现成的 —— 详情门禁已有「非作者看草稿 20001」，
        // 各流与搜索都按 status=1 过滤，pageUserNotes 本人已返回全状态。
        note.setStatus(asDraft ? STATUS_DRAFT : STATUS_PUBLISHED);
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

log.info("笔记{}成功 noteId={} userId={} images={}", asDraft ? "存草稿" : "发布", note.getId(), userId, params.images().size());

        // 稀缺：规划 ES 索引的异步同步。必须在 afterCommit 发送而不是在事务内直接发，
        // 否则「消息进了 Kafka、事务却回滚」会产生索引里有、库里没有的幽灵文档。
        // 发送是异步的且失败只记日志：搜索索引可被 /api/search/reindex 一键重建，不值得拖成功接口
        //
        // ⚠️ **这行之前被误删过**：P17 插入「话题关系行」时，编辑器把它当成了
        // 上一段注释的延续，一起删掉了。结果是发布不再发 ES 事件，而
        // **接口照常返回 200**，契约里的「发布后经 Kafka 异步入搜索索引」
        // 才红 —— 一条与话题毫无关系的断言替你抓到的话题改动出的问题。
        //
        // ⚠️ P50 草稿：**草稿不发事件** —— 它从未进过索引，发 PUBLISH 会造出
        // 「库里 status=0、索引里能搜到」的幽灵文档（门禁挡得住详情，挡不住搜索列表）。
        // 草稿真正发布（0→1）那一刻由 applyStatusChange 发 PUBLISH，路径唯一。
        if (!asDraft) {
            registerAfterCommit(NoteEventDTO.ACTION_PUBLISH, ofEventNote(note, params, dto, STATUS_PUBLISHED));
        }

        // 话题/提及关系行：正文是唯一事实来源，后端自己从 title+content 解析。
        // 放在写完 note/note_image 之后 —— 关系行需要 noteId，而 noteId 到这里才有。
        // P50 草稿：关系行照写（作者自己的草稿详情页仍渲染话题/提及），
        // 但 @ 通知不发 —— notifyMentions=false。
        topicRelationService.replaceRelations(note, note.getTitle(), note.getContent(),
                IdListUtil.parse(dto.getMentionUserIds()), !asDraft);
        // 刚发布的笔记必然没有点赞/收藏/关注作者（自己不能关注自己），三者都是 false。
        // 档位直接回填入参（比从库里的 JSON 再 parse 一遍更省，且此刻两者必然一致）
        NoteVO vo = NoteConverter.toVO(note, userQueryService.getUserVO(userId), params.images(), false, false, false);
        vo.setVideoQualities(params.qualities());
        return vo;
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
        //
        // ⚠️ P50 例外：**草稿编辑保持无图合法** —— 用户存草稿时就可以没图，
        // 编辑没写完的草稿却被「必须带图」拦住，等于草稿功能形同虚设。
        // P21 那条规则管的是「成为对外可见的笔记」；草稿不是。
        int curStatus = note.getStatus() == null ? STATUS_PUBLISHED : note.getStatus();
        // P50：草稿编辑允许正文为空（同 publish 的草稿分支）；已发布/已下架的编辑必须带正文。
        if (curStatus != STATUS_DRAFT && (dto.getContent() == null || dto.getContent().isBlank())) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "正文不能为空");
        }
        if (dto.getContent() == null) {
            dto.setContent("");
        }
        PublishParams params = validatePublishParams(dto, curStatus != STATUS_DRAFT);

        // 用 LambdaUpdateWrapper 显式 set 而不是 updateById：全项目配了
        // update-strategy not_null，updateById 会把「清空的字段」（cover / videoUrl）
        // 当 null 跳过，导致旧值残留。wrapper 的 set 连 null 一起写，语义才是完整覆盖。
        //
        // P48 两处新 set 同一个道理：
        //   - video_qualities 全量覆盖（编辑改成视频/清空视频都要正确归零）；
        //   - 封面对视频笔记也要重新推导（换成新视频后旧封面是错的——它抽帧自旧视频）。
        //     图文沿用第一张图；视频走 coverOf（带磁盘检查，没有封面就落 null，
        //     让列表卡退吉祥物兜底，而不是挂一张 404 的旧图）。
        noteMapper.update(null, Wrappers.<NoteEntity>lambdaUpdate()
                .eq(NoteEntity::getId, noteId)
                .set(NoteEntity::getType, params.type())
                .set(NoteEntity::getTitle, dto.getTitle().trim())
                .set(NoteEntity::getContent, dto.getContent().trim())
                .set(NoteEntity::getVideoUrl, dto.getVideoUrl())
                .set(NoteEntity::getVideoQualities, VideoQualityVO.serialize(objectMapper, params.qualities()))
                .set(NoteEntity::getCover, params.images().isEmpty()
                        ? videoStorage.coverOf(dto.getVideoUrl()) : params.images().get(0))
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
        // 而增量留下的「改了正文还挂着旧话题」残留更难查。
        // P50：草稿编辑照写关系行但不发 @ 通知（理由同 publish）。
        topicRelationService.replaceRelations(note, dto.getTitle().trim(), dto.getContent().trim(),
                IdListUtil.parse(dto.getMentionUserIds()), curStatus != STATUS_DRAFT);
        // 编辑不会让一篇笔记「重新上热搜」：已下架的继续发 UNPUBLISH（确保索引里没有），
        // 正常的才带新标题/正文 re-upsert。
        // ⚠️ P50：草稿**不发任何事件** —— 它从未进过索引，UNPUBLISH 是给
        // 不存在的文档发 deleteById，白占一次消费；发布时由 0→1 那条路发 PUBLISH。
        if (curStatus == STATUS_PUBLISHED) {
            registerAfterCommit(NoteEventDTO.ACTION_PUBLISH, ofEventNote(note, params, dto, curStatus));
        } else if (curStatus == STATUS_TAKEN_DOWN) {
            registerAfterCommit(NoteEventDTO.ACTION_UNPUBLISH, ofEventNote(note, params, dto, curStatus));
        }
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
        assertDraftTransitionAllowed(note, status);
        // P50：草稿发布（0→1）要走「发布」的完整语义 ——
        // 存草稿时 @ 的通知没发（notifyMentions=false），在这里补发，
        // 并把关系行幂等地重写一遍（sanitise 重新过滤已注销/拉黑的用户）。
        // 放在 applyStatusChange 之前：通知走 afterCommit + 吞异常，先失败先报。
        if (Objects.equals(note.getStatus(), STATUS_DRAFT) && Objects.equals(status, STATUS_PUBLISHED)) {
            requirePublishReady(note);
            topicRelationService.replaceRelations(note, note.getTitle(), note.getContent(),
                    topicRelationService.noteMentionUserIds(noteId), true);
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
        // P50：草稿是作者的私有中间态（P21 已定），运营不参与它的生命周期 ——
        // 运营发布别人的草稿等于替作者做「内容已完成」的判断；下架一篇
        // 从未发布的笔记更是无意义。作者侧 changeStatus 的转移规则对草稿
        // 只放行 0→1，这条守卫把运营路径整个挡在外面。
        if (Objects.equals(note.getStatus(), STATUS_DRAFT)) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "草稿只能由作者发布");
        }
        applyStatusChange(note, status);
        log.info("运营强制变更笔记状态 noteId={} status={}", noteId, status);
    }

    private void requireValidStatus(Integer status) {
        // P50：目标值扩到 0|1|2（0 只在「草稿发布」链路里合法，转移规则在调用处判）
        if (status == null || (status != STATUS_PUBLISHED && status != STATUS_TAKEN_DOWN
                && status != STATUS_DRAFT)) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "状态只能是 0（草稿）1（发布）或 2（下架）");
        }
    }

    /**
     * 作者侧状态变更：草稿的转移规则在这里，不在 requireValidStatus 里 ——
     * 运营那条路径（forceChangeStatus）对草稿的处理不同（只能拒绝）。
     *
     * <p>P50 草稿规则：
     * <ul>
     *   <li>0→1：唯一放行的「草稿离开草稿态」方向，且发布前要补上
     *       「图文必带图」的完整校验（存草稿时可以没图）</li>
     *   <li>x→0（含 1→0、2→0）：一律拒绝 —— 已发布/已下架的笔记「转回草稿」
     *       会让它的对外可见性在两种语义间漂移，而下架本身已经承担了
     *       「暂时不可见」的职责，不需要第二个隐藏态</li>
     *   <li>0→2：拒绝 —— 下架一篇从未发布的笔记没有意义</li>
     * </ul>
     */
    private void assertDraftTransitionAllowed(NoteEntity note, Integer status) {
        boolean fromDraft = Objects.equals(note.getStatus(), STATUS_DRAFT);
        if (fromDraft && !Objects.equals(status, STATUS_PUBLISHED)) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "草稿只能被发布");
        }
        if (!fromDraft && Objects.equals(status, STATUS_DRAFT)) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "已发布的笔记不能转回草稿");
        }
    }

    /** 草稿发布前的完整校验：图文必须已经补上图、正文必须已补（存草稿时两者都允许空） */
    private void requirePublishReady(NoteEntity note) {
        if (note.getType() != null && note.getType() == TYPE_GRAPHICAL) {
            Long count = noteImageMapper.selectCount(Wrappers.<NoteImageEntity>lambdaQuery()
                    .eq(NoteImageEntity::getNoteId, note.getId()));
            if (count == null || count == 0) {
                throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "图文笔记必须至少上传一张图片");
            }
        }
        // P50：正文与图是同一组「发布态不变量」—— 存草稿时允许空，0→1 时必须补齐。
        // 漏了这条，「无正文+有图」的草稿会被发布成正文为空的笔记，
        // 与 P11「图文必带图」堵住的形态完全对称。
        if (note.getContent() == null || note.getContent().isBlank()) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "正文不能为空");
        }
        // type=2 的 videoUrl 在存草稿与编辑草稿时都已被 validatePublishParams 强制过，
        // 这里不再重复查 —— DB 是唯一事实来源，它不可能为空
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
    public VideoUploadVO uploadVideo(MultipartFile file) {
        VideoStorage.Stored stored = videoStorage.store(file);
        if (stored.qualities() == null || stored.qualities().isEmpty()) {
            // 降级路径：没有转码出额外档位，qualities 不下发（JSON non_null 连字段都省掉）
            log.info("视频上传完成（单码率）：url={}", stored.url());
            return VideoUploadVO.builder().url(stored.url()).build();
        }
        List<VideoQualityVO> qualities = stored.qualities().stream()
                .map(q -> VideoQualityVO.builder().label(q.label()).url(q.url())
                        .width(q.width()).height(q.height()).build())
                .toList();
        log.info("视频上传完成（{} 档）：url={}", qualities.size(), stored.url());
        return VideoUploadVO.builder().url(stored.url()).qualities(qualities).build();
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
        images.forEach(url -> checkUrl(url, "图片"));

        // P48 多码率档位：只有视频笔记带档位；null/空表都归一成 null（= 单码率）。
        // 刻意的<b>服务端校验而不靠 DTO 注解</b>：档位上限、字段越界这类业务语义
        // 统一在这里，避免「发布挡得住、另一条路径漏放行」的双份门槛。
        List<VideoQualityVO> qualities = dto.getVideoQualities();
        if (type != TYPE_VIDEO || qualities == null || qualities.isEmpty()) {
            qualities = null;
        } else {
            if (qualities.size() > MAX_QUALITY_COUNT) {
                throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR,
                        "清晰度档位最多 " + MAX_QUALITY_COUNT + " 个");
            }
            for (VideoQualityVO q : qualities) {
                if (q == null) {
                    throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "清晰度档位不能为空");
                }
                checkUrl(q.getUrl(), "清晰度");
                if (q.getWidth() != null && q.getWidth() < 0 || q.getHeight() != null && q.getHeight() < 0) {
                    throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, "清晰度尺寸不能为负");
                }
            }
        }
        return new PublishParams(type, images, qualities);
    }

    private record PublishParams(int type, List<String> images, List<VideoQualityVO> qualities) {
    }

    /**
     * 只放行站内相对路径与 http(s)。
     *
     * <p>不校验的话，用户可以把 {@code javascript:alert(1)} 或 {@code data:text/html,...}
     * 存进 note_image.url，前端渲染成 img src 时就构成 XSS。
     * 允许外域 http(s) 是因为业务上要支持引用外部图床，不能一刀切。
     *
     * <p>「what」进报错文案而不是写死「图片」：P48 的清晰度 url 走同一套规则
     * （即便是同一个校验，报「图片地址不合法」也会让用户以为传错的是图）。
     */
    private static void checkUrl(String url, String what) {
        if (url == null || url.isBlank()) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, what + "地址不能为空");
        }
        String lower = url.toLowerCase(Locale.ROOT);
        boolean ok = lower.startsWith("http://")
                || lower.startsWith("https://")
                || (url.startsWith("/") && !url.startsWith("//"));
        if (!ok) {
            throw new BizException(ErrorCodeEnum.PARAM_VALIDATION_ERROR, what + "地址不合法：" + url);
        }
    }
}
