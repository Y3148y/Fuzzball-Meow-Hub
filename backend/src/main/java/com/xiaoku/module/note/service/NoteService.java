package com.xiaoku.module.note.service;

import com.xiaoku.module.note.dto.NotePublishDTO;
import com.xiaoku.module.note.vo.NoteVO;
import org.springframework.web.multipart.MultipartFile;

/**
 * 笔记写操作。
 *
 * <p>与读操作拆开是刻意的：写要事务、要幂等、要考虑并发；
 * 读要多走缓存、多走只读副本。混在一个类里两边都会被对方的约束污染。
 */
public interface NoteService {

    /**
     * 发布笔记。
     *
     * @return 新笔记详情，status 直接为「正常」
     */
    NoteVO publish(NotePublishDTO dto);

    /**
     * 上传单张图片，返回可访问 URL。
     *
     * <p>图片先于笔记存在是<b>有意为之</b>：用户可能上传完不发布，
     * 这类孤儿文件由定时任务清理（P9），不阻塞发布主流程。
     */
    String uploadImage(MultipartFile file);

    /**
     * 编辑笔记（作者本人），请求体与发布同构（全量更新）。
     *
     * <p>非作者一律按「笔记不存在」处理：编辑入口本身不暴露「这篇笔记存在」
     * 的信息，和删除/评论同一套防探测策略。
     */
    NoteVO update(Long noteId, NotePublishDTO dto);

    /**
     * 上架 / 下架笔记（作者本人）。
     *
     * <p>status 只接受 1（发布）或 2（下架）。重复设置同一状态是幂等的，
     * 直接返回当前详情，不重复产生索引事件。
     */
    NoteVO changeStatus(Long noteId, Integer status);

    /**
     * 删除笔记（作者本人，P11）。
     *
     * <p>级联清理：图片、点赞/收藏关系、评论（含子树）与评论点赞、Redis 计数键，
     * 事务提交后发送 DELETE 事件移除 ES 文档。非作者/不存在一律 20001。
     */
    void delete(Long noteId);
}
