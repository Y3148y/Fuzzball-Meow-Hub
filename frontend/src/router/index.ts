import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import { pinia } from '@/stores'
import { useUserStore } from '@/stores/user'

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
    meta: { title: '毛球喵社', requiresAuth: true },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { title: '登录', guestOnly: true },
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('@/views/ProfileView.vue'),
    meta: { title: '我的', requiresAuth: true },
  },
  {
    path: '/publish',
    name: 'publish',
    component: () => import('@/views/PublishView.vue'),
    meta: { title: '发布笔记', requiresAuth: true },
  },
  {
    // 编辑入口只放在「自己笔记的详情页」操作区；直接手输 URL 进别人的笔记
    // 会由后端 20001 拦掉（防探测语义），这里不需要再单独做权限判断
    path: '/edit/:id(\\d+)',
    name: 'note-edit',
    component: () => import('@/views/NoteEditView.vue'),
    meta: { title: '编辑笔记', requiresAuth: true },
  },
  {
    // 关键词走 query 而不走路径参数，中文不用 encode 进 URL，刷新也能保持
    path: '/search',
    name: 'search',
    component: () => import('@/views/SearchView.vue'),
    meta: { title: '搜索', requiresAuth: true },
  },
  {
    // 我的收藏夹（私有数据，没有「TA 收藏了」这种视图）
    path: '/collections',
    name: 'collections',
    component: () => import('@/views/CollectionsView.vue'),
    meta: { title: '我的收藏', requiresAuth: true },
  },
  {
    // 通知中心。铃铛在 App.vue 全局挂载（只挂一次），这里是它的落地页
    path: '/notification',
    name: 'notification',
    component: () => import('@/views/NotificationView.vue'),
    meta: { title: '通知', requiresAuth: true },
  },
  {
    // id 是雪花 ID，必须按字符串透传。这里写 :id(\\d+) 只是收窄非法路径，
    // 不要写成 :id(\\d{1,15}) —— 那样真笔记的 17~18 位 ID 反而进不来。
    path: '/note/:id(\\d+)',
    name: 'note-detail',
    component: () => import('@/views/NoteDetailView.vue'),
    meta: { title: '笔记详情', requiresAuth: true },
  },
  {
    // 这两个路由共用 FollowListView，靠 route.name 区分「关注」还是「粉丝」。
    // id 同样是雪花字符串，不要 Number()。
    path: '/follow/:id(\\d+)',
    name: 'follow',
    component: () => import('@/views/FollowListView.vue'),
    meta: { title: '关注', requiresAuth: true },
  },
  {
    path: '/fans/:id(\\d+)',
    name: 'fans',
    component: () => import('@/views/FollowListView.vue'),
    meta: { title: '粉丝', requiresAuth: true },
  },
  {
    path: '/user/:id(\\d+)',
    name: 'user',
    component: () => import('@/views/UserView.vue'),
    meta: { title: 'TA 的主页', requiresAuth: true },
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

/**
 * 登录守卫。
 *
 * 为什么判断依据放在 localStorage 而不是内存里的 store：
 * accessToken 由 Axios 拦截器在刷新时直接改写 localStorage，
 * 内存里的那份不会跟着变。以 localStorage 为准才能保证
 * 「token 被清掉」和「界面认为是登出」这两件事永远一致。
 */
router.beforeEach((to) => {
  const userStore = useUserStore(pinia)

  if (to.meta.requiresAuth && !userStore.isLogin) {
    // 带上来源，登录完可以跳回原来想去的页面
    return { name: 'login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } }
  }

  // 已登录还去登录页，直接送回首页
  if (to.meta.guestOnly && userStore.isLogin) {
    return { name: 'home' }
  }

  return true
})

router.afterEach((to) => {
  const title = to.meta.title as string | undefined
  document.title = title ? `${title} · 毛球喵社` : '毛球喵社'
  // translate=no：标题与品牌名不该被浏览器自动翻译拆成怪词
  document.documentElement.setAttribute('translate', 'no')
})

export default router
