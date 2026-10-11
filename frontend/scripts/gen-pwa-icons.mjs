// 生成 PWA 图标（PNG）到 frontend/public/icons/。
//
// 为什么走浏览器：public/ 里只有 webp 吉祥物，而 manifest 的 icon 需要 PNG ——
// 尤其 maskable 必须是位图（SVG 在多数平台不被接受）。
// 用页面里 import('/src/utils/textCard.ts') 的同款思路让 Vite 转译，
// 再 canvas 画出来 → dataURL → Node 侧落盘。
import fs from 'node:fs'
import path from 'node:path'
import { createSession, preflight, DEV_ORIGIN } from './ui-cdp.mjs'

const OUT = path.resolve('public/icons')
const TARGETS = [
  { file: 'icon-192.png', size: 192, pad: 0.16 },
  { file: 'icon-512.png', size: 512, pad: 0.16 },
  // maskable：系统会裁掉边缘 10% 安全区，所以主体要**再缩一圈**，
  // 直接拿普通 icon 当 maskable 用，Android 上会切掉小哭猫的脸
  { file: 'icon-maskable-512.png', size: 512, pad: 0.28 },
]

const s = await createSession({ name: 'pwaicons' })
try {
  await preflight()
  await s.goto(DEV_ORIGIN + '/#/login')
  await s.waitFor(`location.origin === ${JSON.stringify(DEV_ORIGIN)}`, '到应用域名', 20000)

  fs.mkdirSync(OUT, { recursive: true })
  for (const t of TARGETS) {
    const dataUrl = await s.evaluate(`(async () => {
      const size = ${t.size}, pad = ${t.pad}
      const c = document.createElement('canvas')
      c.width = size; c.height = size
      const g = c.getContext('2d')
      // 底色与 --xk-surface 同源（浅色主题），避免 Android 上出现白边
      g.fillStyle = '#f4f6fb'
      g.fillRect(0, 0, size, size)
      const img = new Image()
      img.src = '/mascot/m03.webp'
      await img.decode()
      const inner = size * (1 - pad * 2)
      g.drawImage(img, size * pad, size * pad, inner, inner)
      return c.toDataURL('image/png')
    })()`)
    const buf = Buffer.from(String(dataUrl).split(',')[1], 'base64')
    fs.writeFileSync(path.join(OUT, t.file), buf)
    console.log(`  ${t.file}  ${t.size}x${t.size}  ${buf.length} bytes`)
  }
} finally {
  await s.close()
}
console.log('  写入 ' + OUT)