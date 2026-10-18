// 生成预设默认头像（public/avatars/01..08.png）
//
// ⚠️⚠️ **第一版做错了，用户明确否掉了**：当时画的是「中间色调底 + 白色几何符号」
//   （圆环/圆点/菱形/方块/心/星/波纹/弧），理由是「/mascot/m01..m11.webp 是插画，
//   裁成方图会认不出猫」。
//   用户反馈是：「小哭猫的头像怎么变成了五角星」——**预设头像就该是小哭猫**。
//   几何符号和「毛球喵社 / 小哭猫」这个品牌没有关系，而且小哭猫吉祥物在
//   SiteNav、笔记封面兜底等处到处都是，两者并存会让人以为
//   **同一个用户有两个头像**。这一版改成真的用吉祥物。
//
//   吉祥物的宽高比是 0.81~1.99（m02 是 400x212 横图），全都不是正方形，
//   所以做法是：**正方形画布 + 浅色底 + 吉祥物 contain 缩放居中**，
//   不裁切（裁会把猫切掉腿/耳朵），靠**背景色**区分 8 张。
//
// ⚠️ 沿用 gen-pwa-icons.mjs 的零依赖套路（CDP 起浏览器 → canvas 画 →
//    dataURL → Node 落盘），不引入 node-canvas / sharp（那两个都要原生编译）。
//    改配色/用哪只猫要改脚本后重跑，**不要手改 PNG**（不在白名单里就选不到）。
//
// 用法：node scripts/gen-default-avatars.mjs（需要 dev 服务器在 5180）
import fs from 'node:fs'
import path from 'node:path'
import { createSession, preflight, DEV_ORIGIN } from './ui-cdp.mjs'

const OUT = path.resolve('public/avatars')
const SIZE = 256

/** 8 只猫 × 8 个底色。底色要浅且彼此可辨（浅底上深色描边的小哭猫都清楚） */
const PRESETS = [
  { file: '01.png', cat: 'm04', bg: '#ffe7c2' }, // 暖橙
  { file: '02.png', cat: 'm05', bg: '#dbe4ff' }, // 浅蓝
  { file: '03.png', cat: 'm06', bg: '#ffe0e6' }, // 浅粉
  { file: '04.png', cat: 'm07', bg: '#d9f2e6' }, // 薄荷
  { file: '05.png', cat: 'm08', bg: '#efe2ff' }, // 浅紫
  { file: '06.png', cat: 'm10', bg: '#ffeac9' }, // 米黄
  { file: '07.png', cat: 'm11', bg: '#d9ecf5' }, // 天蓝
  { file: '08.png', cat: 'm01', bg: '#e6f0d8' }, // 浅绿
]

/** 页面里执行的绘制函数。参数必须走「入参对象」——
 *  ui-cdp 的 evaluate 只收一个表达式字符串、没有参数通道，
 *  而且箭头函数里没有 arguments。 */
const DRAW = `(async ({ SIZE, cat, bg }) => {
  const c = document.createElement('canvas')
  c.width = SIZE; c.height = SIZE
  const x = c.getContext('2d')

  // 底色铺满（头像容器会切圆/圆角，所以要满）
  x.fillStyle = bg
  x.fillRect(0, 0, SIZE, SIZE)

  const im = new Image()
  im.src = '/mascot/' + cat + '.webp'
  await im.decode()

  // contain 缩放：不裁切（裁会把猫切掉腿/耳朵），四周留白让猫占 ~84%
  const pad = SIZE * 0.08
  const box = SIZE - pad * 2
  const scale = Math.min(box / im.naturalWidth, box / im.naturalHeight)
  const w = im.naturalWidth * scale, h = im.naturalHeight * scale
  x.drawImage(im, (SIZE - w) / 2, (SIZE - h) / 2, w, h)

  return c.toDataURL('image/png')
})`

await preflight()
const s = await createSession({ name: 'gen-avatars' })
try {
  fs.mkdirSync(OUT, { recursive: true })
  await s.goto(DEV_ORIGIN + '/')
  await s.waitFor(`document.readyState === 'complete'`, '页面', 20000)
  for (const p of PRESETS) {
    const call = `(${DRAW})({ SIZE: ${SIZE}, cat: ${JSON.stringify(p.cat)}, bg: ${JSON.stringify(p.bg)} })`
    const dataUrl = await s.evaluate(call)
    const buf = Buffer.from(String(dataUrl).split(',')[1], 'base64')
    fs.writeFileSync(path.join(OUT, p.file), buf)
    console.log('  ' + p.file.padEnd(10) + (buf.length / 1024).toFixed(1) + 'KB  ' + p.cat + ' on ' + p.bg)
  }
  console.log('  → ' + OUT + '（共 ' + PRESETS.length + ' 张，全部是小哭猫）')
} finally {
  await s.close()
}