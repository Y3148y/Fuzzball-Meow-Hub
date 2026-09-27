import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

/**
 * 用 hash 模式而不是 history 模式：
 * 部署时只要把 dist 丢进任意静态目录/对象存储即可，不需要服务端配合做
 * SPA fallback（history 模式下直接刷新 /home 会 404）。
 * 面试可提这一点，以及 history 模式需要 Nginx 加 try_files ... /index.html。
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/HomeView.vue'),
    meta: { title: '小哭猫' },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { title: '登录' },
  },
  {
    // 兜底放最后，防止前面所有路径被吃掉
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.afterEach((to) => {
  const title = to.meta.title as string | undefined
  document.title = title ? `${title} · 小哭猫` : '小哭猫'
})

export default router
