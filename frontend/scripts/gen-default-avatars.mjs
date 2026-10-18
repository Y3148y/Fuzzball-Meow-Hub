// 生成预设默认头像（public/avatars/01..08.png）
//
// ⚠️ 为什么不用 node-canvas / sharp：那两个都要原生编译。本项目已有的
//    gen-pwa-icons.mjs 走的是「CDP 起浏览器 → 页面里 canvas 画 → dataURL →
//    Node 落盘」，零依赖。头像生成沿用同一套路（见 gen-pwa-icons.mjs 顶部注释）。
//
// ⚠️ 为什么要生成而不直接用 /mascot/m01..m11.webp：
//    那 11 张是**插画**（m02 实际是 400x212 的横图），头像要做圆形裁切 + 只有
//    24~62px，裁完只剩猫的一小块，完全认不出来。所以这里另画一套
//    **正方形、中间色调底 + 白色几何符号**的：24px 下轮廓仍然清楚。
//
// 用法：node scripts/gen-default-avatars.mjs（需要 dev 服务器在 5180）
import fs from 'node:fs'
import path from 'node:path'
import { createSession, preflight, DEV_ORIGIN } from './ui-cdp.mjs'

const OUT = path.resolve('public/avatars')
const SIZE = 256

// 中间饱和度底色 + 白色符号：白底/暗底都读得清（WCAG 对比度 ≥3:1）
const PRESETS = [
  { file: '01.png', bg: '#f5a623', glyph: 'ring' },
  { file: '02.png', bg: '#6b7fd7', glyph: 'dot' },
  { file: '03.png', bg: '#e8734a', glyph: 'diamond' },
  { file: '04.png', bg: '#3fa796', glyph: 'square' },
  { file: '05.png', bg: '#d9538a', glyph: 'heart' },
  { file: '06.png', bg: '#f0a830', glyph: 'star' },
  { file: '07.png', bg: '#5b8ff9', glyph: 'waves' },
  { file: '08.png', bg: '#8b6fd0', glyph: 'arc' },
]

/** 在浏览器里画的函数体 —— 必须是纯 JS（会被序列化进页面）
 *  ⚠️ 写成箭头函数时**没有 arguments**，参数只能从入参对象里取。 */
const DRAW = `(async ({ SIZE, glyph, bg }) => {
  const c = document.createElement('canvas')
  c.width = SIZE; c.height = SIZE
  const x = c.getContext('2d')
  const S = SIZE, u = S / 100          // 以 100 为设计栅格，缩放不用改坐标

  // 底：实心方（头像容器自己会切圆/圆角）
  x.fillStyle = bg
  x.fillRect(0, 0, S, S)

  x.fillStyle = '#ffffff'
  x.strokeStyle = '#ffffff'

  if (glyph === 'ring') {
    x.lineWidth = 9 * u
    x.beginPath(); x.arc(S / 2, S / 2, 26 * u, 0, Math.PI * 2); x.stroke()
    x.beginPath(); x.arc(S / 2, S / 2, 9 * u, 0, Math.PI * 2); x.fill()
  } else if (glyph === 'dot') {
    x.beginPath(); x.arc(S / 2, S / 2, 22 * u, 0, Math.PI * 2); x.fill()
  } else if (glyph === 'diamond') {
    x.beginPath()
    x.moveTo(S / 2, 24 * u); x.lineTo(76 * u, S / 2); x.lineTo(S / 2, 76 * u)
    x.lineTo(24 * u, S / 2); x.closePath(); x.fill()
  } else if (glyph === 'square') {
    const r = 12 * u, m = 26 * u, w = S - m * 2
    x.beginPath()
    x.moveTo(m + r, m); x.lineTo(m + w - r, m); x.quadraticCurveTo(m + w, m, m + w, m + r)
    x.lineTo(m + w, m + w - r); x.quadraticCurveTo(m + w, m + w, m + w - r, m + w)
    x.lineTo(m + r, m + w); x.quadraticCurveTo(m, m + w, m, m + w - r)
    x.lineTo(m, m + r); x.quadraticCurveTo(m, m, m + r, m)
    x.closePath(); x.fill()
  } else if (glyph === 'heart') {
    // Path2D 走 SVG path —— 手算贝塞尔控制点太容易错，而浏览器原生支持
    const p = new Path2D(
      'M50 78 C20 58 12 40 22 30 C30 22 42 24 50 34 C58 24 70 22 78 30 C88 40 80 58 50 78 Z')
    x.save(); x.translate(S * 0.13, S * 0.13); x.scale(0.74 * S / 100, 0.74 * S / 100)
    x.fill(p); x.restore()
  } else if (glyph === 'star') {
    const cx = S / 2, cy = S / 2, R = 27 * u, r = R * 0.44
    x.beginPath()
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 ? r : R
      const a = -Math.PI / 2 + (i * Math.PI) / 5
      const px = cx + rad * Math.cos(a), py = cy + rad * Math.sin(a)
      i ? x.lineTo(px, py) : x.moveTo(px, py)
    }
    x.closePath(); x.fill()
  } else if (glyph === 'waves') {
    x.lineWidth = 8 * u; x.lineCap = 'round'
    for (let i = 0; i < 3; i++) {
      const y = (34 + i * 16) * u
      x.beginPath()
      x.moveTo(24 * u, y)
      x.quadraticCurveTo(S / 2, y + (i % 2 ? -11 : 11) * u, S - 24 * u, y)
      x.stroke()
    }
  } else if (glyph === 'arc') {
    x.lineWidth = 10 * u; x.lineCap = 'round'
    x.beginPath(); x.arc(S / 2, S * 0.78, 26 * u, Math.PI * 1.12, Math.PI * 1.88); x.stroke()
    x.beginPath(); x.arc(S / 2, S * 0.78, 13 * u, Math.PI * 1.12, Math.PI * 1.88); x.stroke()
  }
  return c.toDataURL('image/png')
})`

await preflight()
const s = await createSession({ name: 'gen-avatars' })
try {
  fs.mkdirSync(OUT, { recursive: true })
  await s.goto(DEV_ORIGIN + '/')
  await s.waitFor(`document.readyState === 'complete'`, '页面', 20000)
  for (const p of PRESETS) {
    // ⚠️ ui-cdp 的 evaluate 只收**一个表达式字符串**、没有参数通道，
    //    所以参数必须拼进调用处。JSON.stringify 是必须的：
    //    bg 是 '#f5a623'，直接插进单引号字符串会在某些环境下出问题。
    const call = `(${DRAW})({ SIZE: ${SIZE}, glyph: ${JSON.stringify(p.glyph)}, bg: ${JSON.stringify(p.bg)} })`
    const dataUrl = await s.evaluate(call)
    const buf = Buffer.from(String(dataUrl).split(',')[1], 'base64')
    fs.writeFileSync(path.join(OUT, p.file), buf)
    console.log('  ' + p.file.padEnd(10) + (buf.length / 1024).toFixed(1) + 'KB  ' + p.bg + '  ' + p.glyph)
  }
  console.log('  → ' + OUT + '（共 ' + PRESETS.length + ' 张）')
} finally {
  await s.close()
}