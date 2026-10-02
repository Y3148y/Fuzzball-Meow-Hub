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