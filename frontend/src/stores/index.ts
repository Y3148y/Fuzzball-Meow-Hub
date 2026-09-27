import { createPinia } from 'pinia'

/**
 * Pinia 实例单独导出。
 * 路由守卫里要用 store，但守卫执行时组件还没挂载，
 * 靠「当前活跃的 pinia」是不可靠的（SSR / 多应用场景会出问题），
 * 所以显式把实例传进去。
 */
export const pinia = createPinia()
