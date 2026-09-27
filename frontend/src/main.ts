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

const app = createApp(App)

app.use(pinia)
app.use(router)

app.mount('#app')
