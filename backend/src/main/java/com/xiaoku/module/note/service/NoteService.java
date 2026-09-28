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
}
