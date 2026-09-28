package com.xiaoku.module.note.service.impl;

import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.exception.BizException;
import com.xiaoku.common.result.ErrorCodeEnum;
import com.xiaoku.common.storage.ImageStorage;
import com.xiaoku.module.note.converter.NoteConverter;
import com.xiaoku.module.note.dto.NotePublishDTO;
import com.xiaoku.module.note.entity.NoteEntity;
import com.xiaoku.module.note.entity.NoteImageEntity;
import com.xiaoku.module.note.mapper.NoteImageMapper;
import com.xiaoku.module.note.mapper.NoteMapper;
import com.xiaoku.module.note.service.NoteService;
import com.xiaoku.module.note.vo.NoteVO;
import com.xiaoku.module.user.service.UserQueryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Locale;

@Slf4j
@Service
@RequiredArgsConstructor
public class NoteServiceImpl implements NoteService {

    /** 单篇笔记图片上限，与 NOTE_IMAGE_LIMIT_EXCEED 的文案保持一致 */
    private static final int MAX_IMAGE_COUNT = 9;

    private static final int TYPE_GRAPHICAL = 1;
    private static final int TYPE_VIDEO = 2;

    private final NoteMapper noteMapper;
    private final NoteImageMapper noteImageMapper;
    private final UserQueryService userQueryService;
    private final ImageStorage imageStorage;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public NoteVO publish(NotePublishDTO dto) {
        Long userId = UserContextHolder.requireUserId();

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
        images.forEach(NoteServiceImpl::checkImageUrl);

        NoteEntity note = new NoteEntity();
        note.setUserId(userId);
        note.setType(type);
        note.setTitle(dto.getTitle().trim());
        note.setContent(dto.getContent().trim());
        note.setVideoUrl(dto.getVideoUrl());
        // 封面缺省取第一张图，省得前端每篇都单独上传一张
        note.setCover(images.isEmpty() ? null : images.get(0));
        note.setStatus(1);
        noteMapper.insert(note);

        for (int i = 0; i < images.size(); i++) {
            NoteImageEntity image = new NoteImageEntity();
            image.setNoteId(note.getId());
            image.setUrl(images.get(i));
            image.setSort(i);
            noteImageMapper.insert(image);
        }

        log.info("笔记发布成功 noteId={} userId={} images={}", note.getId(), userId, images.size());
        return NoteConverter.toVO(note, userQueryService.getUserVO(userId), images, false);
    }

    @Override
    public String uploadImage(MultipartFile file) {
        return imageStorage.store(file);
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
