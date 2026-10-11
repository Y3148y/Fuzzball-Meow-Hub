/**
 * 生成一张**指定尺寸**的 PNG。
 *
 * <p>为什么不直接用 ui-note.mjs 里的 makePng：那个刻意只造 8×8 的纯色块
 * （最小、最快、内容无关）。而裁剪断言需要**非正方形**的原图 ——
 * 正方形图裁完比例不变，「裁剪有没有生效」只能靠像素尺寸分辨，
 * 断言会退化成「量了一个变了但说不清为什么变的数字」。
 *
 * <p>用最朴素的 zlib stored block（不压缩）编码：几百像素的图片体积也就
 * 几 KB，而 Node 侧零依赖、无需引入 PNG 库。
 */
import fs from 'node:fs'
import zlib from 'node:zlib'

function crc32(buf) {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/**
 * @param opts.quadrant 画四象限异色 —— 用来肉眼与像素双重确认
 *                       「裁剪取到的是哪一块」，而不只是「尺寸变了」
 */
export function makeSizedPng(w, h, opts = {}) {
  const rgb = opts.rgb ?? [200, 70, 150]
  const raw = Buffer.alloc(h * (1 + w * 3))
  const half = { w: Math.floor(w / 2), h: Math.floor(h / 2) }
  for (let y = 0; y < h; y++) {
    const rowStart = y * (1 + w * 3)
    raw[rowStart] = 0 // filter type 0
    for (let x = 0; x < w; x++) {
      const p = rowStart + 1 + x * 3
      if (opts.quadrant) {
        // 四象限：同一象限同色，取景框落在哪象限就能分辨出来
        const right = x >= half.w
        const bottom = y >= half.h
        if (bottom && right) { raw[p] = 40; raw[p + 1] = 120; raw[p + 2] = 220 }
        else if (bottom) { raw[p] = 240; raw[p + 1] = 200; raw[p + 2] = 40 }
        else if (right) { raw[p] = 30; raw[p + 1] = 190; raw[p + 2] = 90 }
        else { raw[p] = rgb[0]; raw[p + 1] = rgb[1]; raw[p + 2] = rgb[2] }
      } else {
        raw[p] = rgb[0]; raw[p + 1] = rgb[1]; raw[p + 2] = rgb[2]
      }
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** 落盘并返回绝对路径，交给 CDP 的 DOM.setFileInputFiles */
export function writePng(dir, name, w, h, opts = {}) {
  const p = `${dir}/${name}`
  fs.writeFileSync(p, makeSizedPng(w, h, opts))
  return p
}