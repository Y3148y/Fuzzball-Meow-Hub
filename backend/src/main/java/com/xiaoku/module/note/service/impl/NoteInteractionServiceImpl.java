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
import com.xiaoku.module.note.support.NoteCounterStore;
import com.xiaoku.module.note.vo.NoteVO;
import com.xiaoku.module.notification.service.NotificationService;
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
    private final NoteCounterStore counterStore;
    private final NotificationService notificationService;

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
        NoteEntity note = requireLikeableNote(noteId);

        NoteLikeEntity like = new NoteLikeEntity();
        like.setUserId(userId);
        like.setNoteId(noteId);
        try {
            noteLikeMapper.insert(like);
        } catch (DuplicateKeyException e) {
            // 重复点赞：把 Redis 成员也补齐（自愈：万一上次 Redis 写入没落），再报已点赞
            counterStore.like(noteId, userId, () -> noteLikeMapper.selectUserIds(noteId));
            throw new BizException(ErrorCodeEnum.ALREADY_LIKED);
        }

        // 计数写入走 Redis（ZSET 置位 + 打脏），不再逐次 update DB 计数列，
        // 由 NoteCounterFlushJob 每 30s 按绝对值对账落库。
        counterStore.like(noteId, userId, () -> noteLikeMapper.selectUserIds(noteId));
        // 通知作者（afterCommit 才落库，写失败也不影响点赞结果）
        notificationService.notifyNoteLike(note.getUserId(), userId, noteId);
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
         * 上面已经执行成功的 delete 和计数变更一起回滚。
         * 也就是说「笔记下架之后用户再也无法取消点赞，计数定格在那儿」。
         *
         * <p>P8 之前计数是 update DB ±1，回滚删关系会一并回滚计数；
         * 现在计数在 Redis（ZREM + 打脏），回滚只回滚 DB 关系行——Redis 侧
         * 已经减掉的那个成员不会被还回来，DB 与 Redis 会短暂不一致，
         * 只能靠 NoteCounterFlushJob 的绝对值对账收敛（它在两边都缺时不动 DB）。
         * 与 P5 的结论一致：真正修好需要给 getDetail 开「非本人可见」的内部旁路，
         * 留到做管理端时一并处理。
         */
        int deleted = noteLikeMapper.delete(Wrappers.<NoteLikeEntity>lambdaQuery()
                .eq(NoteLikeEntity::getUserId, userId)
                .eq(NoteLikeEntity::getNoteId, noteId));
        if (deleted == 0) {
            // 静默成功会让前端以为"确实取消了"，而计数其实没动
            throw new BizException(ErrorCodeEnum.NOT_LIKED_YET);
        }

        counterStore.unlike(noteId, userId, () -> noteLikeMapper.selectUserIds(noteId));
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
            counterStore.collect(noteId, userId, () -> noteCollectMapper.selectUserIds(noteId));
            throw new BizException(ErrorCodeEnum.ALREADY_COLLECTED);
        }

        counterStore.collect(noteId, userId, () -> noteCollectMapper.selectUserIds(noteId));
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

        counterStore.uncollect(noteId, userId, () -> noteCollectMapper.selectUserIds(noteId));
        return noteQueryService.getDetail(noteId);
    }

    /**
     * 点赞/收藏前确认笔记可互动。
     *
     * <p>没有外键约束，note 不存在时 insert 会成功留下一条指向虚空的脏关系，
     * 所以必须先查。而且状态也要查：给一篇已下架的笔记加赞没有意义。
     */
    private NoteEntity requireLikeableNote(Long noteId) {
        NoteEntity note = noteMapper.selectById(noteId);
        if (note == null) {
            throw new BizException(ErrorCodeEnum.NOTE_NOT_FOUND);
        }
        if (note.getStatus() == null || note.getStatus() != STATUS_PUBLISHED) {
            throw new BizException(ErrorCodeEnum.NOTE_STATUS_ILLEGAL, "该笔记当前状态不支持点赞或收藏");
        }
        // 返回实体而不只是校验：调用方要拿 userId 去给作者发通知
        return note;
    }
}
