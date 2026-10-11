import { createApp } from 'vue'

import App from './App.vue'
import router from './router'
import { pinia } from './stores'
// 保留全量 Vant 样式而不是只靠 VantResolver 按需引入，两个原因：
// 1. vant/lib/index.css 里才有 .van-theme-dark 这套暗色变量，
//    只引组件样式的话深色模式会缺变量
// 2. 我们的 token 覆盖要压在 Vant 之后，全量引入的顺序是确定的
import 'vant/lib/index.css'
import './styles/main.css'
import { registerServiceWorker } from './utils/serviceWorker'

const app = createApp(App)

app.use(pinia)
app.use(router)

app.mount('#app')

// P27：**生产构建才注册**。开发时注册会让 CDP 测试打到缓存里的旧资源，
// 症状是「刚改好的东西莫名其妙又坏了」，而真因是浏览器缓存（见文件头注释）。
registerServiceWorker()
