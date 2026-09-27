package com.xiaoku.common.util;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.NetworkInterface;
import java.util.Enumeration;

/**
 * 雪花算法（Snowflake）生成 64 位 Long 型分布式 ID。
 *
 * <p>位分配（自高位到低位，1 位符号 + 41 位时间戳 + 10 位机器 + 12 位序列号）：
 * <pre>
 *   0 | 41bit 毫秒时间戳 | 10bit 机器ID | 12bit 序列号
 *   1 | 0000000000  | 1000100101  | 000000000001
 * </pre>
 *
 * <p><b>为什么不用数据库自增？</b> 自增 ID 在分库分表后会冲突，且插入时数据库要维护
 * AUTO_INCREMENT 锁，单表写入会成为热点。
 *
 * <p><b>为什么不用 UUID？</b> UUID 是 128 位字符串（36 字符），作为 InnoDB 主键时：
 * 存储空间是 BIGINT 的近 2 倍；随机写入导致 B+ 树页分裂严重；作为聚簇索引主键时
 * 二级索引都要带上主键，索引体积翻倍。
 *
 * <p><b>单机可用范围：</b> 41 位毫秒时间戳约可用 69 年（从自定义纪元起算），
 * 10 位机器号支持 1024 个节点，12 位序列号支持同一毫秒内 4096 个 ID。
 *
 * <p><b>面试要点 —— 时钟回拨怎么办：</b>
 * <ul>
 *     <li>回拨幅度小（&lt;= 5ms）：自旋等待追平；</li>
 *     <li>回拨幅度大：直接抛异常并告警，绝不能默默生成重复 ID。
 *         很多生产事故就出在「回拨时用旧时间戳继续发号」，
 *         结果一段时间内产生重复 ID，写进唯一索引直接报错。</li>
 * </ul>
 */
@Component
public class SnowflakeIdGenerator {

    /** 起始纪元：2024-01-01 00:00:00 UTC 的毫秒数 */
    private static final long TWEPOCH = 1704067200000L;

    private static final long MACHINE_ID_BITS = 10L;
    private static final long SEQUENCE_BITS = 12L;

    private static final long MAX_MACHINE_ID = ~(-1L << MACHINE_ID_BITS);
    private static final long MAX_SEQUENCE = ~(-1L << SEQUENCE_BITS);

    private static final long MACHINE_ID_SHIFT = SEQUENCE_BITS;
    private static final long TIMESTAMP_SHIFT = SEQUENCE_BITS + MACHINE_ID_BITS;

    /** 允许的最大时钟回拨毫秒数 */
    private static final long MAX_TOLERATE_CLOCK_BACKWARD_MILLIS = 5L;

    private final long machineId;

    private long lastTimestamp = -1L;
    private long sequence = 0L;

    public SnowflakeIdGenerator(@Value("${xiaoku.snowflake.machine-id:1}") long machineId) {
        if (machineId < 0 || machineId > MAX_MACHINE_ID) {
            throw new IllegalArgumentException(
                    "机器ID超出范围 [0, " + MAX_MACHINE_ID + "]，检查配置 xiaoku.snowflake.machine-id");
        }
        this.machineId = machineId;
    }

    /**
     * 供启动日志/健康检查使用。
     */
    public long getMachineId() {
        return machineId;
    }

    public synchronized long nextId() {
        long timestamp = System.currentTimeMillis();

        // 情况 1：时钟回拨
        if (timestamp < lastTimestamp) {
            long offset = lastTimestamp - timestamp;
            if (offset <= MAX_TOLERATE_CLOCK_BACKWARD_MILLIS) {
                // 小幅回拨：自旋等待时钟追平
                try {
                    wait(offset << 1);
                    timestamp = System.currentTimeMillis();
                    if (timestamp < lastTimestamp) {
                        throw new IllegalStateException("时钟回拨自旋等待后仍未追平，放弃发号");
                    }
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("发号被中断", ie);
                }
            } else {
                throw new IllegalStateException(
                        "检测到严重时钟回拨 " + offset + "ms，拒绝发号以避免生成重复ID");
            }
        }

        // 情况 2：同一毫秒内，序列号递增
        if (timestamp == lastTimestamp) {
            sequence = (sequence + 1) & MAX_SEQUENCE;
            if (sequence == 0) {
                // 序列号耗尽，说明这一毫秒内已经发了 4096 个 ID，自旋到下一毫秒
                timestamp = waitNextMillis(lastTimestamp);
            }
        } else {
            // 新的一毫秒，序列号归零
            sequence = 0L;
        }

        lastTimestamp = timestamp;

        return ((timestamp - TWEPOCH) << TIMESTAMP_SHIFT)
                | (machineId << MACHINE_ID_SHIFT)
                | sequence;
    }

    private long waitNextMillis(long lastTimestamp) {
        long timestamp = System.currentTimeMillis();
        while (timestamp <= lastTimestamp) {
            timestamp = System.currentTimeMillis();
        }
        return timestamp;
    }

    /**
     * 无配置时尝试从本机网卡 MAC 推导一个稳定的 machineId。
     * <p>注意：生产环境不要用这种方式，多实例部署时可能算出相同值，
     * 应当由 ZNODES / Redis 分配等外部手段保证唯一。
     */
    public static long deriveMachineId() {
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces.hasMoreElements()) {
                NetworkInterface ni = interfaces.nextElement();
                byte[] mac = ni.getHardwareAddress();
                if (mac != null && mac.length >= 2) {
                    return ((0x000000FF & (long) mac[mac.length - 1])
                            | (0x0000FF00 & (((long) mac[mac.length - 2]) << 8))) >> 6;
                }
            }
        } catch (Exception ignored) {
            // 拿不到网卡就回落到 0
        }
        return 0L;
    }

    /**
     * 便于人工排查：把雪花 ID 拆回各段。
     */
    public static String parse(long id) {
        long timestamp = (id >> TIMESTAMP_SHIFT) + TWEPOCH;
        long machineId = (id >> MACHINE_ID_SHIFT) & MAX_MACHINE_ID;
        long sequence = id & MAX_SEQUENCE;
        return String.format("{timestamp=%s, machineId=%d, sequence=%d}",
                java.time.Instant.ofEpochMilli(timestamp), machineId, sequence);
    }
}
