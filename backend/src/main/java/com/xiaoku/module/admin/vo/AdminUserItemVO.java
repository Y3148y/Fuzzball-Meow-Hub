package com.xiaoku.module.admin.vo;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 运营视角的用户行。
 *
 * <p>刻意<b>不含 password</b>，也不返回 id 之外的用户隐私字段：
 * 运营后台的可见范围应当是「处置所必需的最少信息」。
 * 需要更多细节时再有针对性地加字段，而不是整个 UserVO 倒出去 ——
 * UserVO 是给「别人的主页」用的，那是完全不同的信任级别。
 */
@Data
public class AdminUserItemVO {

    private Long id;

    private String username;

    private String nickname;

    private String bio;

    /** 0 禁用 1 正常 */
    private Integer status;

    /** 0 普通用户 1 管理员 */
    private Integer role;

    private Integer noteCount;

    /** 该用户被举报的次数：运营判断「是不是惯犯」最直接的依据 */
    private Integer reportCount;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime createTime;
}