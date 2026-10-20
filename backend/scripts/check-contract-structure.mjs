/**
 * 契约测试文件结构体检（P17 记的三条不变量）。
 *
 * ① 全文花括号净额 = 0
 * ② main() 体内「深度 2→1」的出现次数与 HEAD 基准一致（多一次说明有个块提前闭合）
 * ③ node --check 通过（由调用方跑）
 *
 * ⚠️ 为什么需要它：这个文件 3300+ 行，改动通常是**插入式**的。
 *    插入式改动最危险的失败模式是「顺手删掉了紧随其后的语句」——
 *    而症状出现在几十行之外（比如「某个功能没生效」），真因隔了整屏。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

function analyze(src) {
  // ⚠️ **顺序要紧：先剥字符串，再剥注释**。
  // 反过来的话，字符串里的 `//`（比如 'http://localhost:8088'）会被当成行注释，
  // 于是把该行后半段（含引号）一起吃掉 → 那个字符串没被剥掉 →
  // 里面的花括号被算进净数 → 报「块没闭合」。
  // 症状是「HEAD 版本也报同样的话」，说明是工具自己的错而不是文件的错。
  const s = src
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

  let depth = 0
  let net = 0
  let twoToOne = 0
  let maxDepth = 0
  for (const ch of s) {
    if (ch === '{') {
      depth++
      if (depth > maxDepth) maxDepth = depth
    } else if (ch === '}') {
      if (depth === 2) twoToOne++
      depth--
    }
  }
  net = depth
  return { net, twoToOne, maxDepth }
}

const cur = readFileSync(process.argv[2] ?? 'backend/scripts/contract-test.mjs', 'utf8')
let head = ''
try {
  head = execFileSync('git', ['show', 'HEAD:backend/scripts/contract-test.mjs'], { encoding: 'utf8' })
} catch {
  console.log('（拿不到 HEAD 版本，跳过对比）')
}

const a = analyze(cur)
console.log('当前：', JSON.stringify(a))
console.log(a.net === 0 ? '  ✅ 花括号净额 = 0' : `  ❌ 花括号净额 = ${a.net}（块没闭合）`)

if (head) {
  const b = analyze(head)
  console.log('HEAD：', JSON.stringify(b))
  const delta = a.twoToOne - b.twoToOne
  console.log(`  深度 2→1 次数：${b.twoToOne} → ${a.twoToOne}（${delta >= 0 ? '+' : ''}${delta}）`)
  console.log(delta === 0
    ? '  ✅ 与 HEAD 相同'
    : `  ⚠️ 变了 ${delta} 次 —— 确认新增的块都是同深度的兄弟块`)
}
