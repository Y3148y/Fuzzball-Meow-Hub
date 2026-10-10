/**
 * 日期时间格式化。
 *
 * 为什么不用手搓字符串：原来的写法是
 * `createTime.replace('T', ' ').slice(0, 16)` —— 没有任何 locale 语义，
 * 补零、排序、格式全靠约定（web-design-guidelines 明确要求
 * "Dates/times: use Intl.DateTimeFormat not hardcoded formats"）。
 *
 * 为什么输出仍是 `2026-10-01 16:40`：用 `formatToParts` 取各字段自己拼，
 * 这样数字来自 Intl 的 locale 规则，视觉与旧版逐字符一致 —— 换 locale 时
 * 只需改第一个参数，不用重写拼接逻辑。
 *
 * 时区：后端返回的是 `LocalDateTime`（无时区，形如 `2026-10-01T16:40:00`）。
 * 按 ES2015+ 规范，无时区的 date-time 形式按**本地时间**解析，不会发生时区偏移。
 * 刻意不写 `new Date(x + 'Z')`：那会把服务器时区当基准，用户换时区就看到错位时间。
 */
const DT = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function part(d: Date, type: 'year' | 'month' | 'day' | 'hour' | 'minute'): string {
  return DT.formatToParts(d).find((p) => p.type === type)?.value ?? ''
}

/** `2026-10-01 16:40` */
export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const date = `${part(d, 'year')}-${part(d, 'month')}-${part(d, 'day')}`
  const time = `${part(d, 'hour')}:${part(d, 'minute')}`
  return `${date} ${time}`
}

/**
 * 相对时间：`刚刚` / `3 分钟前` / `昨天 14:20` / `10-01`
 *
 * <p>**刻意只给会话列表用**，不给搜索结果、收藏夹、个人中心那些
 * 「批量浏览列表」用 —— 那些位置是让用户判断内容新旧的，
 * 全变成「3 天前」就没法比较了（同样是列表，语义完全不同）。
 *
 * <p>阈值取的是中文语境下常见的口径：一天内用分钟/小时，
 * 超过一天先显示「昨天」（带时刻），再往前只显示月-日。
 * 「昨天」需要分别判断昨天/今天 —— `setHours(0,0,0,0)` 取当天零点
 * 再比，而不是用 `86400000` 减一天：夏令时切换那天那个常数是错的。
 */
export function formatRelative(iso: string | undefined | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()

  // 未来时间（服务器时钟漂移 / 时区差异）不显示「-1 分钟前」这种负数
  if (diffMs < 0) return formatDateTime(iso)

  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`

  // 取「昨天零点」而不是 `startOfToday - 86400000`：夏令时切换那天
  // 一天不是正好 24 小时，那个常数会算出错误的边界。
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime()
  const hhmm = `${part(d, 'hour')}:${part(d, 'minute')}`

  if (d.getTime() >= startOfToday) return `${Math.floor(min / 60)} 小时前`
  if (d.getTime() >= startOfYesterday) return `昨天 ${hhmm}`

  const sameYear = d.getFullYear() === now.getFullYear()
  return sameYear ? `${part(d, 'month')}-${part(d, 'day')}` : formatDateTime(iso)
}