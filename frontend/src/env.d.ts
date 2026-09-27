/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 接口基础路径，走 Vite 代理转发 */
  readonly VITE_API_BASE?: string
  /** 开发代理目标后端地址 */
  readonly VITE_API_TARGET?: string
  readonly VITE_PORT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
