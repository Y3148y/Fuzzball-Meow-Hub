-- =====================================================================
--  毛球喵社 Fuzzball-Meow-Hub —— 初始化脚本
--  执行： mysql -u root -p < schema.sql
--  字符集说明： utf8mb4 + utf8mb4_general_ci
--    不用 utf8mb4_0900_ai_ci，因为后者仅 MySQL 8.0+ 支持，
--    而生产环境很可能是 5.7，跨版本会直接报 Unknown character set。
--  逻辑删除说明：
--    所有表都不加 is_deleted。点赞/收藏这类「行为明细表」一旦逻辑删除，
--    统计 COUNT(*) 就会算错；改为物理删除，用唯一索引(user_id + note_id)
--    天然保证「同一用户不会重复点赞」，幂等性下沉到存储层。
-- =====================================================================

CREATE DATABASE IF NOT EXISTS `xiaoku_db`
    DEFAULT CHARACTER SET utf8mb4
    DEFAULT COLLATE utf8mb4_general_ci;

USE `xiaoku_db`;

-- ---------------------------------------------------------------------
-- 用户表
--   冗余计数列：follow_count / fans_count / like_received_count
--   这三列不实时计算，异步落库（详见 P5/P6），理由是避免热点行锁竞争。
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `user`;
CREATE TABLE `user`
(
    `id`                 BIGINT UNSIGNED NOT NULL COMMENT '雪花算法生成的用户ID',
    `username`           VARCHAR(32)     NOT NULL COMMENT '登录用户名',
    `password`           VARCHAR(100)    NOT NULL COMMENT 'BCrypt 加密后的密码',
    `nickname`           VARCHAR(32)     NOT NULL COMMENT '昵称',
    `avatar`             VARCHAR(512)             DEFAULT NULL COMMENT '头像URL',
    `bio`                VARCHAR(255)             DEFAULT NULL COMMENT '个人简介',
    `gender`             TINYINT         NOT NULL DEFAULT '0' COMMENT '性别 0未知 1男 2女',
    `follow_count`       INT             NOT NULL DEFAULT 0 COMMENT '关注数',
    `fans_count`         INT             NOT NULL DEFAULT 0 COMMENT '粉丝数',
    `like_received_count` INT             NOT NULL DEFAULT 0 COMMENT '获赞总数',
    `status`             TINYINT         NOT NULL DEFAULT '1' COMMENT '状态 0禁用 1正常',
    `last_login_time`    DATETIME                 DEFAULT NULL COMMENT '最后登录时间',
    `create_time`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted`            TINYINT         NOT NULL DEFAULT 0 COMMENT '逻辑删除标记（用户表可逻辑删）',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_username` (`username`),
    KEY `idx_create_time` (`create_time`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci COMMENT ='用户表';

-- ---------------------------------------------------------------------
-- 笔记表
--   type   : 1图文 2视频
--   status : 0草稿 1正常 2已下架（审核不通过/用户删除）
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `note`;
CREATE TABLE `note`
(
    `id`          BIGINT UNSIGNED NOT NULL COMMENT '雪花算法生成的笔记ID',
    `user_id`     BIGINT UNSIGNED NOT NULL COMMENT '作者ID',
    `type`        TINYINT         NOT NULL DEFAULT 1 COMMENT '类型 1图文 2视频',
    `title`       VARCHAR(64)              DEFAULT NULL COMMENT '标题',
    `content`     VARCHAR(2000)            DEFAULT NULL COMMENT '正文',
    `cover`       VARCHAR(512)             DEFAULT NULL COMMENT '封面图URL',
    `video_url`   VARCHAR(512)             DEFAULT NULL COMMENT '视频URL（type=2时必填）',
    `status`      TINYINT         NOT NULL DEFAULT 1 COMMENT '状态 0草稿 1正常 2下架',
    `like_count`  INT             NOT NULL DEFAULT 0 COMMENT '点赞数',
    `collect_count` INT           NOT NULL DEFAULT 0 COMMENT '收藏数',
    `comment_count` INT            NOT NULL DEFAULT 0 COMMENT '评论数',
    `create_time` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    -- 「某人的笔记列表」按时间倒序分页，走这个联合索引避免 filesort
    KEY `idx_user_id_create_time` (`user_id`, `create_time` DESC),
    -- 「首页最新」流
    KEY `idx_status_create_time` (`status`, `create_time` DESC)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci COMMENT ='笔记表';

-- ---------------------------------------------------------------------
-- 笔记图片表（一篇笔记多张图，独立成表便于分页/排序）
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `note_image`;
CREATE TABLE `note_image`
(
    `id`          BIGINT UNSIGNED NOT NULL,
    `note_id`     BIGINT UNSIGNED NOT NULL COMMENT '所属笔记ID',
    `url`         VARCHAR(512)    NOT NULL COMMENT '图片URL',
    `sort`        INT             NOT NULL DEFAULT 0 COMMENT '排序序号',
    `create_time` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_note_id_sort` (`note_id`, `sort`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci COMMENT ='笔记图片表';

-- ---------------------------------------------------------------------
-- 点赞表
--   uk_user_note 是本项目「幂等性」的核心设计：
--   重复请求会直接撞唯一索引报错，天然不会产生重复数据，
--   也就不会出现「计数加了两次」的经典 bug。
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `note_like`;
CREATE TABLE `note_like`
(
    `id`          BIGINT UNSIGNED NOT NULL,
    `user_id`     BIGINT UNSIGNED NOT NULL COMMENT '点赞人ID',
    `note_id`     BIGINT UNSIGNED NOT NULL COMMENT '被点赞的笔记ID',
    `create_time` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_user_note` (`user_id`, `note_id`),
    KEY `idx_note_id` (`note_id`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci COMMENT ='笔记点赞表';

-- ---------------------------------------------------------------------
-- 收藏表
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `note_collect`;
CREATE TABLE `note_collect`
(
    `id`          BIGINT UNSIGNED NOT NULL,
    `user_id`     BIGINT UNSIGNED NOT NULL COMMENT '收藏人ID',
    `note_id`     BIGINT UNSIGNED NOT NULL COMMENT '被收藏的笔记ID',
    `create_time` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_user_note` (`user_id`, `note_id`),
    KEY `idx_note_id` (`note_id`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci COMMENT ='笔记收藏表';

-- ---------------------------------------------------------------------
-- 评论表（两级：root_id=0 为根评论，其余指向 root_comment_id）
--   超过两级不再嵌套，回复时带上被回复人昵称展示，
--   避免无限层级递归查询。
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `comment`;
CREATE TABLE `comment`
(
    `id`                BIGINT UNSIGNED NOT NULL,
    `note_id`           BIGINT UNSIGNED NOT NULL COMMENT '所属笔记ID',
    `user_id`           BIGINT UNSIGNED NOT NULL COMMENT '评论人ID',
    `root_comment_id`   BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '根评论ID，0表示根评论',
    `parent_id`         BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '被回复的评论ID',
    `reply_user_id`     BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '被回复人ID，0表示无',
    `content`           VARCHAR(1000)   NOT NULL COMMENT '评论内容',
    `like_count`        INT             NOT NULL DEFAULT 0 COMMENT '点赞数',
    `create_time`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    -- 「某笔记的评论」按时间正序
    KEY `idx_note_id_create_time` (`note_id`, `create_time`),
    KEY `idx_root_comment_id` (`root_comment_id`),
    KEY `idx_user_id` (`user_id`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci COMMENT ='评论表';

-- ---------------------------------------------------------------------
-- 评论点赞表
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `comment_like`;
CREATE TABLE `comment_like`
(
    `id`          BIGINT UNSIGNED NOT NULL,
    `user_id`     BIGINT UNSIGNED NOT NULL,
    `comment_id`  BIGINT UNSIGNED NOT NULL,
    `create_time` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_user_comment` (`user_id`, `comment_id`),
    KEY `idx_comment_id` (`comment_id`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci COMMENT ='评论点赞表';

-- ---------------------------------------------------------------------
-- 关注关系表
--   从表是 user_id（谁关注的），to_user_id 是 follow_id（关注了谁）
--   uk_user_follow 保证不能重复关注
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `user_follow`;
CREATE TABLE `user_follow`
(
    `id`           BIGINT UNSIGNED NOT NULL,
    `user_id`      BIGINT UNSIGNED NOT NULL COMMENT '发起关注的用户ID',
    `follow_id`    BIGINT UNSIGNED NOT NULL COMMENT '被关注的用户ID',
    `status`       TINYINT         NOT NULL DEFAULT 1 COMMENT '1已关注 2已取关（保留行以便恢复）',
    `create_time`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_user_follow` (`user_id`, `follow_id`),
    KEY `idx_follow_id` (`follow_id`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci COMMENT ='用户关注关系表';

-- ---------------------------------------------------------------------
-- 通知表（2026-10-05 新增）
--   一行 = 「有人对我做了一件事」。这是社交闭环最短的那条链：没有它，
--   别人赞了我/评论了我我完全不知道，注册量会卡在「看客」阶段。
--
--   type 语义（枚举在 NotificationType.java，改这里要同步改那个）：
--     1 NOTE_LIKE      赞了我的笔记
--     2 COMMENT        评论了我的笔记
--     3 COMMENT_LIKE   赞了我的评论
--     4 FOLLOW         关注了我
--     5 COMMENT_REPLY  回复了我的评论
--
--   actor_id = 谁做的；target_id = 被作用的对象（笔记ID或评论ID）；
--   note_id 冗余一份笔记ID，让「通知列表」可以不做 JOIN 就知道每条属于哪篇笔记
--   （回复/评论点赞都要落到具体某篇笔记上）。物理删除，不做逻辑删除。
--
--   read_flag 为什么不加 UNIQUE：同一个人可以多次赞同一篇笔记，但只保留
--   **最早那一条**（UNIQUE(receiver_id, actor_id, type, target_id)），
--   重复点赞时用 UPDATE 改时间而不是插新行 —— 通知列表不该被同一个人刷屏。
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `notification`;
CREATE TABLE `notification`
(
    `id`           BIGINT UNSIGNED NOT NULL COMMENT '雪花算法生成的通知ID',
    `receiver_id`  BIGINT UNSIGNED NOT NULL COMMENT '收到通知的人（当前用户）',
    `actor_id`     BIGINT UNSIGNED NOT NULL COMMENT '触发通知的人',
    `type`         TINYINT         NOT NULL COMMENT '1赞笔记 2评论 3赞评论 4关注 5回复',
    `target_id`    BIGINT UNSIGNED NOT NULL COMMENT '被作用的笔记ID或评论ID（关注类=被关注者userId）',
    `note_id`      BIGINT UNSIGNED DEFAULT NULL COMMENT '所属笔记ID（冗余，免 JOIN）；**关注类通知为 NULL** —— 不要拿userId 冒充笔记ID',
    `content`      VARCHAR(200)    DEFAULT NULL COMMENT '冗余的评论/回复内容摘要，便于列表直接展示',
    `is_read`      TINYINT         NOT NULL DEFAULT 0 COMMENT '0未读 1已读',
    `create_time`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_notify_once` (`receiver_id`, `actor_id`, `type`, `target_id`),
    KEY `idx_receiver_time` (`receiver_id`, `is_read`, `create_time`, `id`),
    KEY `idx_receiver_unread` (`receiver_id`, `is_read`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci COMMENT ='用户通知表';
