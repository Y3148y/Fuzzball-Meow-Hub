/**
 * 举报弹窗（P21）
 *
 * <p>**为什么抽成组件而不是每个视图各写一份**：举报有三个入口
 * （笔记详情页的「⋯」、评论的「⋯」、作者主页的「⋯」），而完整流程有五步：
 * 拉原因列表 → 选对象 → 选原因 → 提交 → 处理 80003 重复举报。
 * 抄三遍就意味着「加一步要改三处」，而漏掉 80003 那步的症状是
 * 第二次举报时用户以为提交失败了。
 *
 * <p>**原因选项来自后端，不写死在前端**：运营随时能加/改分类，
 * 写死就得跟着发版才能改（与 ReportController 里那条注释同源）。
 *
 * <p>对外只暴露 `open(...)` + 一组状态：调用方不需要知道内部有三步，
 * 也不该自己判断「这次是笔记还是评论」——那是本模块的职责。
 */
import { ref } from 'vue'
import { showSuccessToast, showToast } from 'vant'
import { BizError } from '@/api/request'
import { listReportReasons, reportContent } from '@/api/report'
import type { ReportReasonVO, ReportTarget } from '@/api/report'
import { ErrorCode } from '@/api/types'

/** 1 笔记 2 评论 —— 与后端 ReportTargetType 同一个口径 */
export type ReportTargetType = 1 | 2

const reasons = ref<ReportReasonVO[]>([])
const targets = ref<ReportTarget[]>([])
const picked = ref<ReportTarget | null>(null)
const type = ref<ReportTargetType>(1)
const title = ref('')
const open = ref(false)
const busy = ref(false)

let fetching = false

async function loadReasons() {
  if (reasons.value.length || fetching) return
  fetching = true
  try {
    reasons.value = await listReportReasons()
  } catch {
    // 拿不到原因列表时弹窗只显示「暂无原因可选」，而不是整页报错
    reasons.value = []
  } finally {
    fetching = false
  }
}

/**
 * 打开举报弹窗
 *
 * @param t     1 笔记 / 2 评论
 * @param items 可选对象。**多于一个时**才让用户选；只有一个直接选中
 * @param label 弹窗标题
 */
async function openReport(t: ReportTargetType, items: ReportTarget[], label: string) {
  type.value = t
  targets.value = items
  picked.value = items.length === 1 ? items[0] : null
  title.value = label
  open.value = true
  await loadReasons()
}

async function submit(reason: ReportReasonVO) {
  if (busy.value) return
  if (!picked.value) {
    showToast('请选择要举报的内容')
    return
  }
  busy.value = true
  try {
    await reportContent(type.value, picked.value.id, reason.code)
    showSuccessToast('已举报，我们会尽快处理')
    open.value = false
  } catch (e) {
    // 80003 = 已经举报过。uk_report_once 是**永久**的且没有撤回接口，
    // 所以第二次必然撞；这不是失败，是产品承诺的行为，要给明确提示而不是报错。
    if (e instanceof BizError && e.code === ErrorCode.ALREADY_REPORTED) {
      showToast('你已经举报过这条内容了')
      open.value = false
      return
    }
    showToast(e instanceof BizError ? e.message : '举报失败，请稍后重试')
  } finally {
    busy.value = false
  }
}

function close() {
  open.value = false
  picked.value = null
}

export function useReportSheet() {
  return { reasons, targets, picked, title, open, busy, openReport, submit, close }
}