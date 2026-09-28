package com.xiaoku.module.note.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.xiaoku.module.note.entity.NoteCollectEntity;
import org.apache.ibatis.annotations.Mapper;

/** 收藏关系，对应 note_collect 表 */
@Mapper
public interface NoteCollectMapper extends BaseMapper<NoteCollectEntity> {
}
