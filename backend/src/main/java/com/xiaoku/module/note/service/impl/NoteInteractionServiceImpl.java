package com.xiaoku.module.note.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import com.xiaoku.module.note.entity.NoteCollectEntity;
import com.xiaoku.module.note.entity.NoteEntity;
import com.xiaoku.module.note.entity.NoteLikeEntity;
import com.xiaoku.module.note.mapper.NoteCollectMapper;
import com.xiaoku.module.note.mapper.NoteLikeMapper;
import com.xiaoku.module.note.mapper.NoteMapper;
import com.xiaoku.module.note.service.NoteInteractionService;
import com.xiaoku.module.note.service.NoteQueryService;
import com.xiaoku.module.note.vo.NoteVO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Slf4j
@Service
@RequiredArgsConstructor
public class NoteInteractionServiceImpl implements NoteInteractionService {

    private static final int STATUS_PUBLISHED = 1;

    private final NoteMapper noteMapper;
    private final NoteLikeMapper noteLikeMapper;
    private final NoteCollectMapper noteCollectMapper;
    private final NoteQueryService noteQueryService;

    /**
     * <b>防重为什么不写成「先 select 查一下再 insert」？</b>
     *
     * <p>因为那是典型的 check-then-act 竞态：A、B 同时到达，
     * 都在 select 时查到"还没点赞"，然后都执行 insert，
     * 结果依赖唯一索引 {@code uk_user_note} 谁先谁后。
     * 有人为了"友好"还会 catch 掉异常当成功——那就彻底错了。
     *
     * <p>这里<b>只 insert，把唯一索引当唯一的裁判</b>：
     * 并发下必然有且只有一个成功，另一个拿到 DuplicateKeyException。
     * 数据库约束在 InnoDB 里对同一索引项是加锁的，比应用层的先查可靠。
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public NoteVO like(Long noteId) {
        Long userId = UserContextHolder.requireUserId();
        requireLikeableNote(noteId);

        NoteLikeEntity like = new NoteLikeEntity();
        like.setUserId(userId);
        like.setNoteId(noteId);
        try {
            noteLikeMapper.insert(like);
        } catch (DuplicateKeyException e) {
            throw new BizException(ErrorCodeEnum.ALREADY_LIKED);
        }

        noteMapper.updateLikeCount(noteId, 1);
        return noteQueryService.getDetail(noteId);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public NoteVO unlike(Long noteId) {
        Long userId = UserContextHolder.requireUserId();

        /*
         * 这里<b>刻意不</b>调 requireLikeableNote：取消操作不应该因为笔记状态被拒。
         *
         * <p><b>但注意一个当前阶段修不掉的坑</b>：末尾的 getDetail 会对
         * 已下架的笔记抛 20002，而本方法是 @Transactional，异常会连带
         * 上面已经执行成功的 delete 和计数自增一起回滚。
         * 也就是说「笔记下架之后用户再也无法取消点赞，计数定格在那儿」。
         *
         * <p>要真正修好得让 getDetail 对「非本人可见的未发布内容」有个内部旁路，
         * 但那会牵出一个更难的问题：一个曾经点过赞的路人，是否有权在取消时
         * 读到这篇草稿的内容。所以这里不猜语义，把缺口写清楚。
         * P5 没有下架/编辑接口，这条分支目前<b>无法被触发</b>，也就无从测试；
         * 等真正做管理端时，连同计数重算策略一起处理。
         */
        int deleted = noteLikeMapper.delete(Wrappers.<NoteLikeEntity>lambdaQuery()
                .eq(NoteLikeEntity::getUserId, userId)
                .eq(NoteLikeEntity::getNoteId, noteId));
        if (deleted == 0) {
            // 静默成功会让前端以为"确实取消了"，而计数其实没动
            throw new BizException(ErrorCodeEnum.NOT_LIKED_YET);
        }

        noteMapper.updateLikeCount(noteId, -1);
        return noteQueryService.getDetail(noteId);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public NoteVO collect(Long noteId) {
        Long userId = UserContextHolder.requireUserId();
        requireLikeableNote(noteId);

        NoteCollectEntity collect = new NoteCollectEntity();
        collect.setUserId(userId);
        collect.setNoteId(noteId);
        try {
            noteCollectMapper.insert(collect);
        } catch (DuplicateKeyException e) {
            throw new BizException(ErrorCodeEnum.ALREADY_COLLECTED);
        }

        noteMapper.updateCollectCount(noteId, 1);
        return noteQueryService.getDetail(noteId);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public NoteVO uncollect(Long noteId) {
        Long userId = UserContextHolder.requireUserId();

        int deleted = noteCollectMapper.delete(Wrappers.<NoteCollectEntity>lambdaQuery()
                .eq(NoteCollectEntity::getUserId, userId)
                .eq(NoteCollectEntity::getNoteId, noteId));
        if (deleted == 0) {
            throw new BizException(ErrorCodeEnum.NOT_COLLECTED_YET);
        }

        noteMapper.updateCollectCount(noteId, -1);
        return noteQueryService.getDetail(noteId);
    }

    /**
     * 点赞/收藏前确认笔记可互动。
     *
     * <p>没有外键约束，note 不存在时 insert 会成功留下一条指向虚空的脏关系，
     * 所以必须先查。而且状态也要查：给一篇已下架的笔记加赞没有意义。
     */
    private void requireLikeableNote(Long noteId) {
        NoteEntity note = noteMapper.selectById(noteId);
        if (note == null) {
            throw new BizException(ErrorCodeEnum.NOTE_NOT_FOUND);
        }
        if (note.getStatus() == null || note.getStatus() != STATUS_PUBLISHED) {
            throw new BizException(ErrorCodeEnum.NOTE_STATUS_ILLEGAL, "该笔记当前状态不支持点赞或收藏");
        }
    }
}
