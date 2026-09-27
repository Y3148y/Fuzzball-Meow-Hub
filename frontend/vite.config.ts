import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { VantResolver } from 'unplugin-vue-components/resolvers'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      vue(),
      // Vant 组件按需自动引入，避免整包打进 bundle
      Components({
        dts: 'src/components.d.ts',
        resolvers: [VantResolver()],
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: '0.0.0.0',
      port: Number(env.VITE_PORT ?? 5180),
      // 端口被占用时直接报错，而不是静默顺延到 5177。
      // 开发时静默换端口很容易踩坑：以为改的是 5173，实际跑在别处
      strictPort: true,
      // 开发期统一走 /api 前缀，由 Vite 代理转发到后端。
      // 这样前端代码里不出现硬编码域名，部署时只需改 Nginx 转发规则
      proxy: {
        '/api': {
          target: env.VITE_API_TARGET ?? 'http://127.0.0.1:8088',
          changeOrigin: true,
        },
        // 后端本地磁盘图片的静态映射
        '/static': {
          target: env.VITE_API_TARGET ?? 'http://127.0.0.1:8088',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      // 生产环境把 Vue 等体积大的依赖拆成独立 chunk，利用浏览器长期缓存。
      // 用函数形式而不是对象形式：Rollup 5 的类型只保留了函数签名，
      // 对象写法虽然运行时还能用，但 vue-tsc 会报错。
      rollupOptions: {
        output: {
          manualChunks(id) {
            // 先判 vant，否则 'vant' 里的路径不会命中上面两条，顺序不能换
            if (id.includes('node_modules/vant')) return 'vant'
            if (
              id.includes('node_modules/vue') ||
              id.includes('node_modules/@vue') ||
              id.includes('node_modules/pinia')
            ) {
              return 'vue'
            }
            return null
          },
        },
      },
      chunkSizeWarningLimit: 800,
    },
  }
})
