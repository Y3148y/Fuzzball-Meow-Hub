package com.xiaoku.module.note.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.xiaoku.module.note.entity.NoteImageEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface NoteImageMapper extends BaseMapper<NoteImageEntity> {

    /**
     * 批量取多篇笔记的图（P34 沉浸流）
     *
     * <p>⚠️ **刻意是一条 SQL 而不是逐篇 {@code selectList}**：
     * 沉浸流一屏一页、每页 5~10 篇，逐篇查就是 5~10 次往返，
     * 而这个页面的形态是「一直往下划」——每划一次多几十毫秒的往返，
     * 手感上就是「偶尔卡一下」。
     *
     * <p>返回顺序<b>按 note_id + sort</b>，而前端要用这个顺序做卡内轮播，
     * 所以排序不是可选的。{@code note_id} 也要排：否则同一篇的图会散在结果集里。
     *
     * <p>⚠️ **必须用 {@code <script>} 包裹**：MyBatis 只认被 script 包住的字符串
     * 才会当动态 SQL 解析，否则 {@code <foreach>} 被当普通文本，
     * 里面的 {@code #{id}} 变成一个「找不到的具名参数」。症状是
     * {@code BindingException: Parameter 'id' not found. Available parameters are
     * [param1, noteIds]} —— <b>报错说的是参数名，与「你忘了 script 标签」隔了一整屏</b>，
     * 而接口只是返回 100999（AGENTS P18 记过同一个坑）。
     */
    @Select("""
            <script>
            SELECT note_id, url FROM note_image
            WHERE note_id IN <foreach collection="noteIds" item="id" open="(" close=")" separator=",">#{id}</foreach>
            ORDER BY note_id, sort, id
            </script>
            """)
    List<NoteImageEntity> listByNoteIds(@Param("noteIds") List<Long> noteIds);
}
