/**
 * 未保存内容提醒。
 *
 * 场景：发布/编辑页填了一半正文，直接点导航或返回 → 内容静默丢失。
 * web-design-guidelines 的 "Warn before navigation with unsaved changes"
 * 要求显式拦截。
 *
 * 两条通道：
 * 1. `onBeforeRouteLeave` —— 应用内路由跳转，弹 Vant 确认框，可选「留在本页」。
 * 2. `beforeunload` —— 刷新 / 关标签页。**只能是浏览器原生确认框**，
 *    无法定制文案，也拦不住。
 *
 * ⚠️ 与自动化测试的冲突（这一条是本 composable 存在的最大理由）：
 * CDP 的 `Page.navigate` 遇到未处理的 `beforeunload` 会**卡住**等原生对话框。
 * 布局审计的 `fillPublish` 会填满标题正文再 `s.goto` 跳下一页，此时 dirty=true。
 * 对策在 `scripts/ui-cdp.mjs`：注册 `Page.javascriptDialogOpening` → 自动
 * `Page.handleJavaScriptDialog({accept:true})`。**如果实测仍然挂住，
 * 就把 beforeunload 那一段摘掉，只保留路由内拦截**（宁可少拦一种，
 * 也不要让测试套件卡死）。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { showConfirmDialog } from 'vant'

export function useUnsavedChanges(isDirty: () => boolean) {
  /** 由调用方在提交成功后调用，把状态清成"已保存" */
  const clean = ref(false)

  function dirty(): boolean {
    return !clean.value && isDirty()
  }

  onBeforeRouteLeave(async () => {
    if (!dirty()) return true
    try {
      await showConfirmDialog({
        title: '内容还没保存',
        message: '离开这一页会丢掉刚才写的内容，确定走吗？',
        confirmButtonText: '丢掉并离开',
        cancelButtonText: '继续写',
      })
      return true
    } catch {
      // 取消按钮 / 弹窗被关掉 → 留在本页
      return false
    }
  })

  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (!dirty()) return
    // 标准做法：禁止默认行为 + 写 returnValue，浏览器才显示确认框
    e.preventDefault()
    e.returnValue = ''
  }

  onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
  onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))

  return { markClean: () => (clean.value = true) }
}