package com.xiaoku.module.message.service;

import com.xiaoku.common.result.PageVO;
import com.xiaoku.module.message.dto.MessageSendDTO;
import com.xiaoku.module.message.vo.MessageSessionVO;
import com.xiaoku.module.message.vo.MessageVO;

import java.util.List;

/**
 * 私信服务
 *
 * <p><b>P22 刻意只做 1 对 1</b>：群聊要多一张成员表，而小红书自己也很少用 ——
 * 「有但没人用」的功能会把每个页面都撑复杂。先把一对一这条链做完整
 * （会话、未读、已读回执、拉黑互禁），群聊是之后在<b>同一个会话模型</b>上加一层。
 */
public interface MessageService {

    /** 发送消息。对方拉黑了我时抛 {@code MESSAGE_TARGET_BLOCKED} */
    MessageVO send(MessageSendDTO dto);

    /**
     * 某个会话的聊天记录（正序，最早→最新）
     *
     * @param withPeerId 对方 userId
     */
    PageVO<MessageVO> history(Long withPeerId, int page, int size);

    /** 会话列表，按最后一条消息倒序 */
    List<MessageSessionVO> listSessions();

    /** 总未读消息数（会话页角标） */
    int unreadCount();

    /** 某个会话全部标已读，返回受影响条数 */
    int readAll(Long withPeerId);
}