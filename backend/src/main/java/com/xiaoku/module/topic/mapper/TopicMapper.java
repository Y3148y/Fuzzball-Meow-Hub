package com.xiaoku.module.topic.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.xiaoku.module.topic.entity.TopicEntity;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/** 话题，对应 topic 表 */
@Mapper
public interface TopicMapper extends BaseMapper<TopicEntity> {

    /**
     * 按名字批量插入，冲突则什么都不做
     *
     * <p>靠 {@code uk_topic_name} 当裁判是唯一正确的并发做法。两个用户同时发
     * 「#咖啡」时，先查后插的写法两个事务都会查到「不存在」，然后都去 insert，
     * 第二个撞唯一索引异常 —— 而异常会一路冒到接口，用户看到 500。
     * {@code INSERT IGNORE} 把这个竞争收进 SQL 内部：谁先插成功，另一个静默跳过。
     *
     * <p>被 IGNORE 掉的不一定是「已存在」这一种（字段超长也会被 ignore），
     * 但 {@code name} 是从用户正文里抠出来的、已在发布校验里限长，
     * 所以这里只可能是重复。
     */
    @Insert("""
            INSERT IGNORE INTO topic (id, name, status, create_time, update_time)
            VALUES (#{id}, #{name}, 1, NOW(), NOW())
            """)
    int insertIgnore(@Param("id") Long id, @Param("name") String name);

    /**
     * 按名字批量查（不分大小写也不折叠 —— 话题名是原文，中英文混排时
     * 折叠容易把两个不同话题合并成一个）
     */
    @Select("""
            <script>
            SELECT * FROM topic WHERE name IN
            <foreach collection="names" item="n" open="(" separator="," close=")">#{n}</foreach>
            </script>
            """)
    List<TopicEntity> selectByNames(@Param("names") List<String> names);

    /**
     * 话题列表 + 实时笔记数
     *
     * <p>{@code note_count} 是子查询现算的，不落库 —— 见 schema.sql 里那段说明。
     * 一页 20 行 → 20 次走 {@code idx_topic_note} 的 count，很快。
     *
     * <p>只统计 status=1 的笔记：下架/草稿不该让话题看起来热门。
     */
    @Select("""
            SELECT t.id, t.name, t.description, t.status,
                   (SELECT COUNT(*) FROM note_topic nt
                       INNER JOIN note n ON n.id = nt.note_id AND n.status = 1
                    WHERE nt.topic_id = t.id) AS note_count
            FROM topic t
            WHERE t.status = 1
            ORDER BY note_count DESC, t.id DESC
            LIMIT #{size} OFFSET #{offset}
            """)
    List<TopicCountRow> pageHotTopics(@Param("offset") long offset, @Param("size") int size);

    @Select("""
            SELECT COUNT(*) FROM topic WHERE status = 1
            """)
    long countTopics();

    /** 列表行的投影（note_count 不在实体里） */
    class TopicCountRow {
        private Long id;
        private String name;
        private String description;
        private Integer status;
        private Long noteCount;

        public Long getId() {
            return id;
        }

        public String getName() {
            return name;
        }

        public String getDescription() {
            return description;
        }

        public Integer getStatus() {
            return status;
        }

        public Long getNoteCount() {
            return noteCount;
        }
    }
}