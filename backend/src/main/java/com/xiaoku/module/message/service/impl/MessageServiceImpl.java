package com.xiaoku.module.message.service.impl;

import com.baomidou.mybatisplus.core.toolkit.IdWorker;
import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import com.xiaoku.common.result.PageVO;
import com.xiaoku.module.message.dto.MessageSendDTO;
import com.xiaoku.module.message.entity.MessageEntity;
import com.xiaoku.module.message.entity.MessageSessionEntity;
import com.xiaoku.module.message.mapper.MessageMapper;
import com.xiaoku.module.message.mapper.MessageSessionMapper;
import com.xiaoku.module.message.service.MessageService;
import com.xiaoku.module.message.vo.MessageSessionVO;
import com.xiaoku.module.message.vo.MessageVO;
import com.xiaoku.module.user.mapper.UserBlockMapper;
import com.xiaoku.module.user.service.UserQueryService;
import com.xiaoku.module.user.vo.UserVO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Slf4j
@Service
@RequiredArgsConstructor
public class MessageServiceImpl implements MessageService {

    /** last_message 列是 VARCHAR(200)：摘要超长截断，不让 SQL 报错 */
    private static final int BRIEF_MAX = 200;

    private final MessageMapper messageMapper;
    private final MessageSessionMapper sessionMapper;
    private final UserQueryService userQueryService;
    private final UserBlockMapper userBlockMapper;

    /* ============================ 发送 ============================ */

    @Override
    @Transactional(rollbackFor = Exception.class)
    public MessageVO send(MessageSendDTO dto) {
        Long me = UserContextHolder.requireUserId();
        Long peerId = dto.getToUserId();

        if (peerId.equals(me)) {
            throw new BizException(ErrorCodeEnum.CANNOT_MESSAGE_SELF);
        }
        // 先确认对方真的存在 —— 顺带挡掉「给不存在的 ID 发消息」这种探测
        UserVO peer = userQueryService.findUserVO(peerId);
        if (peer == null) {
            throw new BizException(ErrorCodeEnum.USER_NOT_FOUND);
        }
        // 拉黑是**双向生效**的（见 UserBlockMapper.selectHiddenUserIds），所以
        // 这里查的是「我们两个之间有没有任何一条拉黑关系」。
        //
        // ⚠️ 返回的错误码刻意**不区分是谁拉黑了谁**：P18 已经定过这个原则 ——
        // 「TA 拉黑了你」的提示等于把对方的操作暴露出去，会把普通屏蔽变成社交对抗。
        // 但「消息发不出去」这个结果无法隐藏（不发错误码的话前端会以为发送成功）。
        // 这是这个设计里唯一无法完全藏住的地方，代价限定在「知道对方在屏蔽我」，
        // 换不来的是「能绕过屏蔽继续发消息」。
        if (isBlockedEitherWay(me, peerId)) {
            throw new BizException(ErrorCodeEnum.MESSAGE_TARGET_BLOCKED);
        }

        String content = dto.getContent().strip();
        MessageSessionEntity session = resolveSession(me, peerId);

        MessageEntity e = new MessageEntity();
        e.setSessionId(session.getId());
        e.setSenderId(me);
        e.setReceiverId(peerId);
        e.setContent(content);
        e.setIsRead(0);
        messageMapper.insert(e);

        // 会话行：最后一条 + 对方未读数，在同一个事务里推进。
        // 排序键与未读数必须一起落库，否则列表页刷新后会看到
        // 「顺序变了但角标没跳」这种用户可见的中间态。
        boolean lowIsReceiver = session.getUserLowId().equals(peerId);
        boolean highIsReceiver = session.getUserHighId().equals(peerId);
        sessionMapper.advanceOnSend(session.getId(), brief(content), e.getCreateTime(),
                lowIsReceiver, highIsReceiver);

        return MessageVO.builder()
                .id(e.getId())
                .sessionId(session.getId())
                .senderId(me)
                .receiverId(peerId)
                .content(content)
                .isRead(0)
                .createTime(e.getCreateTime())
                .build();
    }

    /**
     * 拿到（或建出）会话
     *
     * <p>「查不到就插，插的时候靠唯一索引判重，重复了就再查一次」——
     * 而不是「先查再插」。两个方向同时首次发消息时，两个事务都会查到
     * 「不存在」，然后都去插，后一个撞唯一索引抛异常一路冒成 500。
     * 规范化（low/high 有序）之后，同一对人的两个方向在<b>物理上</b>就是同一行，
     * 唯一索引才能真正当裁判。
     */
    private MessageSessionEntity resolveSession(Long me, Long peerId) {
        long low = Math.min(me, peerId);
        long high = Math.max(me, peerId);

        MessageSessionEntity s = sessionMapper.selectByPair(low, high);
        if (s != null) {
            return s;
        }
        // id 必须是新的雪花，不能与已有行撞（INSERT IGNORE 会连主键冲突一起吞掉，
        // 那就变成「插不进去也查不到」，两人都卡在没有会话的状态）。
        // 这里用 IdWorker 而不是让 MyBatis-Plus 的 ASSIGN_ID 填 —— 那条路只在
        // 走 insert() 时生效，而这里是自定义的 insertIgnore()。
        sessionMapper.insertIgnore(IdWorker.getId(), low, high);
        s = sessionMapper.selectByPair(low, high);
        if (s == null) {
            // 只有一种可能：雪花 ID 撞了同一毫秒同一序列位。极罕见，但要给出
            // 可诊断的错误而不是让后面 NPE
            throw new BizException(ErrorCodeEnum.MESSAGE_SEND_FAILED);
        }
        return s;
    }

    /* ============================ 读取 ============================ */

    @Override
    public PageVO<MessageVO> history(Long withPeerId, int page, int size) {
        Long me = UserContextHolder.requireUserId();
        MessageSessionEntity session = requireSession(me, withPeerId);

        long total = messageMapper.countBySession(session.getId());
        long offset = (long) (page - 1) * size;
        List<MessageEntity> rows = messageMapper.pageBySessionDesc(session.getId(), offset, size);

        // SQL 取的是「最新的 N 条」（倒序），这里翻正 —— 聊天记录要从最早往上滚，
        // 而数据库分页只能往后取。reverse 之后才是页面上看到的顺序。
        Collections.reverse(rows);
        return PageVO.of(rows.stream().map(this::toVO).toList(), total, page, size);
    }

    @Override
    public List<MessageSessionVO> listSessions() {
        Long me = UserContextHolder.requireUserId();
        int size = 50;
        List<MessageSessionEntity> rows = sessionMapper.pageMySessions(me, 0, size);
        if (rows.isEmpty()) {
            return List.of();
        }

        // 一次批量拿全部对方的 UserVO，而不是每行一次查询（列表页 N+1）
        List<Long> peerIds = rows.stream().map(s -> s.peerOf(me)).toList();
        Map<Long, UserVO> peers = userQueryService.findUserVOMap(peerIds);

        List<MessageSessionVO> out = new ArrayList<>(rows.size());
        for (MessageSessionEntity s : rows) {
            Long peerId = s.peerOf(me);
            UserVO peer = peerId == null ? null : peers.get(peerId);
            out.add(MessageSessionVO.builder()
                    .sessionId(s.getId())
                    .peerId(peerId)
                    // 对方注销时回退成「已注销用户」而不是整行消失：
                    // 私信是历史事实，不该因为某人注销就查不到（与通知同一个理由）
                    .peerNickname(peer == null ? "已注销用户" : peer.getNickname())
                    .peerAvatar(peer == null ? null : peer.getAvatar())
                    .lastMessage(s.getLastMessage())
                    .lastTime(s.getLastTime())
                    .unread(s.unreadOf(me))
                    .build());
        }
        return out;
    }

    @Override
    public int unreadCount() {
        Long me = UserContextHolder.requireUserId();
        // Math.toIntExact：真有 2^31+ 条未读时宁可抛异常也不静默回绕成负数
        // （与 NotificationServiceImpl 同一个处理）
        return Math.toIntExact(messageMapper.countUnread(me));
    }

    /* ============================ 已读 ============================ */

    @Override
    @Transactional(rollbackFor = Exception.class)
    public int readAll(Long withPeerId) {
        Long me = UserContextHolder.requireUserId();
        MessageSessionEntity session = requireSession(me, withPeerId);
        // 两个都要清：消息行的 is_read 是 ground truth，会话行的未读数是列表页的快速读，
        // 只清一个会让「角标没了但进会话页还显示 N 条未读」或反过来
        int n = messageMapper.markAllReadInSession(session.getId(), me);
        sessionMapper.clearUnread(session.getId(), me);
        return n;
    }

    /* ============================ 内部 ============================ */

    /**
     * 取会话，不存在则报错
     *
     * <p>刻意对「查不到」与「对方拉黑了我」抛<b>同一个</b>错误码：会话列表
     * 本来就只显示有过往来的会话，一个从没聊过的人「查不到会话」是正常结果，
     * 而「拉黑后会话突然打不开」如果换个错误码就等于告诉对方「你被屏蔽了」。
     */
    private MessageSessionEntity requireSession(Long me, Long withPeerId) {
        long low = Math.min(me, withPeerId);
        long high = Math.max(me, withPeerId);
        MessageSessionEntity s = sessionMapper.selectByPair(low, high);
        if (s == null) {
            throw new BizException(ErrorCodeEnum.MESSAGE_SESSION_NOT_FOUND);
        }
        return s;
    }

    /** 两个方向有没有任何一条拉黑关系 */
    private boolean isBlockedEitherWay(Long a, Long b) {
        Set<Long> hidden = new HashSet<>(userBlockMapper.selectHiddenUserIds(a));
        return hidden.contains(b);
    }

    private MessageVO toVO(MessageEntity e) {
        return MessageVO.builder()
                .id(e.getId())
                .sessionId(e.getSessionId())
                .senderId(e.getSenderId())
                .receiverId(e.getReceiverId())
                .content(e.getContent())
                .isRead(e.getIsRead())
                .createTime(e.getCreateTime())
                .build();
    }

    /** 会话列表的摘要：单行、限长 */
    private static String brief(String content) {
        if (content == null) {
            return null;
        }
        String s = content.replaceAll("\\s+", " ").strip();
        return s.length() <= BRIEF_MAX ? s : s.substring(0, BRIEF_MAX - 1) + "…";
    }
}