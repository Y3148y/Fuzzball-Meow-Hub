package com.xiaoku.module.admin.mapper;

import com.xiaoku.module.admin.vo.AdminNoteItemVO;
import com.xiaoku.module.admin.vo.AdminUserItemVO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Map;

/**
 * 运营后台专用查询。
 *
 * <p>刻意<b>不复用</b>现有的 NoteMapper / UserMapper：那些 SQL 是站在「读者视角」写的
 * （只出 status=1、只填和当前浏览者相关的关系字段），而运营要看的恰好是
 * <b>读者看不见的那些</b> —— 下架的笔记、被举报的用户、待处理的举报。
 * 硬塞进读者查询的结果是到处加 {@code if (isAdmin)}，
 * 每加一个字段都要判断两次，漏一次就是把管理端数据漏给普通用户。
 *
 * <p>⚠️ 这些 SQL 里<b>不能用裸的 {@code <} 或 {@code &}</b>：{@code @Select} 里写了
 * {@code <if>/<foreach>} 就会被 MyBatis 当 XML 解析，裸 {@code <} 会直接
 * {@code SAXParseException}（报错说的是「创建 document 实例失败」，与 SQL 毫无关系）。
 * MySQL 里 {@code <>} 与 {@code !=} 等价，用 {@code !=} 绕开转义。
 */
@Mapper
public interface AdminMapper {

    /* ==================== 举报 ==================== */

    /** 举报列表：JOIN 举报人昵称，被举报内容在 Java 侧补（评论/笔记两张表要分开查） */
    @Select("""
            <script>
            SELECT r.id, r.target_type, r.target_id, r.reason_code, r.detail,
                   r.status, r.handle_note, r.create_time, r.update_time,
                   ru.nickname AS reporter_nickname, ru.username AS reporter_username
            FROM report r
            LEFT JOIN user ru ON ru.id = r.reporter_id
            <where>
                <if test="status != null">AND r.status = #{status}</if>
                <if test="targetType != null">AND r.target_type = #{targetType}</if>
            </where>
            ORDER BY r.status ASC, r.create_time DESC, r.id DESC
            LIMIT #{size} OFFSET #{offset}
            </script>
            """)
    List<Map<String, Object>> pageReports(@Param("status") Integer status,
                                          @Param("targetType") Integer targetType,
                                          @Param("offset") long offset,
                                          @Param("size") int size);

    @Select("""
            <script>
            SELECT COUNT(*)
            FROM report r
            <where>
                <if test="status != null">AND r.status = #{status}</if>
                <if test="targetType != null">AND r.target_type = #{targetType}</if>
            </where>
            </script>
            """)
    long countReports(@Param("status") Integer status, @Param("targetType") Integer targetType);

    /* ==================== 用户 ==================== */

    /**
     * 用户列表。
     *
     * <p>{@code note_count} 与 {@code report_count} 都是<b>关联统计而非冗余列</b>：
     * user 表上本来就有 follow_count / fans_count 这类冗余列，但举报次数这种
     * 「随举报动作不断变化」的量不值得为它加一个异步刷新的列 ——
     * 真要加就会引入「刷列失败导致运营按旧数据处置」的坏情况，
     * 而这里一次子查询就够。
     */
    @Select("""
            <script>
            SELECT u.id, u.username, u.nickname, u.bio, u.status, u.role, u.create_time,
                   (SELECT COUNT(*) FROM note n WHERE n.user_id = u.id) AS note_count,
                   (SELECT COUNT(*)
                      FROM report r
                      INNER JOIN note n2 ON n2.id = r.target_id AND r.target_type = 1
                     WHERE n2.user_id = u.id) AS report_count
            FROM user u
            <where>
                u.deleted = 0
                <if test="keyword != null and keyword != ''">
                    AND (u.username LIKE CONCAT('%', #{keyword}, '%')
                         OR u.nickname LIKE CONCAT('%', #{keyword}, '%'))
                </if>
                <if test="status != null">AND u.status = #{status}</if>
            </where>
            ORDER BY u.create_time DESC, u.id DESC
            LIMIT #{size} OFFSET #{offset}
            </script>
            """)
    List<AdminUserItemVO> pageUsers(@Param("keyword") String keyword,
                                    @Param("status") Integer status,
                                    @Param("offset") long offset,
                                    @Param("size") int size);

    @Select("""
            <script>
            SELECT COUNT(*)
            FROM user u
            <where>
                u.deleted = 0
                <if test="keyword != null and keyword != ''">
                    AND (u.username LIKE CONCAT('%', #{keyword}, '%')
                         OR u.nickname LIKE CONCAT('%', #{keyword}, '%'))
                </if>
                <if test="status != null">AND u.status = #{status}</if>
            </where>
            </script>
            """)
    long countUsers(@Param("keyword") String keyword, @Param("status") Integer status);

    /* ==================== 笔记 ==================== */

    /**
     * 笔记列表。<b>不过滤 status</b> —— 运营要看的就是全部状态，
     * 外加「被举报几次」这个判断依据。
     */
    @Select("""
            <script>
            SELECT n.id, n.user_id AS author_id, n.type, n.title, n.content, n.status,
                   n.cover, n.video_url, n.like_count, n.collect_count, n.comment_count,
                   n.create_time,
                   u.nickname AS author_nickname, u.username AS author_username,
                   (SELECT COUNT(*) FROM report r
                     WHERE r.target_type = 1 AND r.target_id = n.id) AS report_count
            FROM note n
            LEFT JOIN user u ON u.id = n.user_id
            <where>
                <if test="keyword != null and keyword != ''">
                    AND (n.title LIKE CONCAT('%', #{keyword}, '%')
                         OR n.content LIKE CONCAT('%', #{keyword}, '%')
                         OR u.username LIKE CONCAT('%', #{keyword}, '%'))
                </if>
                <if test="status != null">AND n.status = #{status}</if>
                <if test="type != null">AND n.type = #{type}</if>
            </where>
            ORDER BY n.create_time DESC, n.id DESC
            LIMIT #{size} OFFSET #{offset}
            </script>
            """)
    List<AdminNoteItemVO> pageNotes(@Param("keyword") String keyword,
                                    @Param("status") Integer status,
                                    @Param("type") Integer type,
                                    @Param("offset") long offset,
                                    @Param("size") int size);

    @Select("""
            <script>
            SELECT COUNT(*)
            FROM note n
            LEFT JOIN user u ON u.id = n.user_id
            <where>
                <if test="keyword != null and keyword != ''">
                    AND (n.title LIKE CONCAT('%', #{keyword}, '%')
                         OR n.content LIKE CONCAT('%', #{keyword}, '%')
                         OR u.username LIKE CONCAT('%', #{keyword}, '%'))
                </if>
                <if test="status != null">AND n.status = #{status}</if>
                <if test="type != null">AND n.type = #{type}</if>
            </where>
            </script>
            """)
    long countNotes(@Param("keyword") String keyword,
                    @Param("status") Integer status,
                    @Param("type") Integer type);
}