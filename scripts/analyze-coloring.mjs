/**
 * 上色阶段帧负载分析（离线、确定性）。
 * 复刻 assets/intro.html 中 colorLayer 的排期算法，统计每秒/每帧要改多少个
 * path 的 opacity，找出突发帧，并给出与 7s 特效事件的重叠区间。
 *
 * 用法：node scripts/analyze-coloring.mjs
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const html = await readFile(resolve(root, 'assets/intro.html'), 'utf8')

const start = html.indexOf('id="colorLayer"')
if (start < 0) throw new Error('colorLayer not found')
const end = html.indexOf('</svg>', start)
const seg = html.slice(start, end)

const items = []
const pathRe = /<path\b[^>]*>/g
let pm
while ((pm = pathRe.exec(seg))) {
  const tm = /transform="translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(pm[0])
  items.push({ x: tm ? +tm[1] : 1024, y: tm ? +tm[2] : 576 })
}

const baseMatch = /var BASE=(\{[^}]*\})/.exec(html)
const BASE = baseMatch ? Function('return (' + baseMatch[1] + ')')() : {}

let nb = 0
for (let i = 0; i < items.length; i++) if (BASE[i]) nb++

const list = []
let seen = 0
for (let i = 0; i < items.length; i++) {
  const { x, y } = items[i]
  let k, band
  if (BASE[i]) {
    k = 0.09 * (nb > 1 ? seen / (nb - 1) : 0)
    seen++
    band = 'base'
  } else if (x >= 405 && x <= 1190) {
    k = 0.09 + 0.51 * (y / 1152)
    band = 'subject'
  } else {
    k = 0.6 + 0.4 * (y / 1152)
    band = 'environment'
  }
  list.push({ i, k, band })
}
list.sort((a, b) => a.k - b.k)
const kmax = list.length ? list[list.length - 1].k : 1
const START = 4980
const DUR = 2500
const shapes = list.map((s) => ({ ...s, t: START + DUR * (s.k / kmax) }))

const byBand = { base: 0, subject: 0, environment: 0 }
for (const s of shapes) byBand[s.band]++

const tMin = Math.min(...shapes.map((s) => s.t))
const tMax = Math.max(...shapes.map((s) => s.t))

// 备选排期：保持每个 band 的时间窗不变，但把该 band 内的路径按顺序均匀铺开，
// 消除“同一 y 值大量路径挤在同一帧”造成的突发。
function scheduleBandUniform() {
  const ranges = {}
  for (const band of ['base', 'subject', 'environment']) {
    const ts = shapes.filter((s) => s.band === band).map((s) => s.t)
    ranges[band] = [Math.min(...ts), Math.max(...ts)]
  }
  const out = []
  for (const band of ['base', 'subject', 'environment']) {
    const arr = shapes.filter((s) => s.band === band).sort((a, b) => a.t - b.t)
    const [a, b] = ranges[band]
    arr.forEach((s, i) => {
      const r = arr.length > 1 ? i / (arr.length - 1) : 0
      out.push({ ...s, t: a + (b - a) * r })
    })
  }
  return out
}

function analyze(fps, source) {
  const frame = 1000 / fps
  const tMin2 = Math.min(...source.map((s) => s.t))
  const tMax2 = Math.max(...source.map((s) => s.t))
  const nFrames = Math.ceil((tMax2 - tMin2) / frame) + 1
  const bins = new Array(nFrames).fill(0)
  for (const s of source) {
    const idx = Math.min(nFrames - 1, Math.floor((s.t - tMin2) / frame))
    bins[idx]++
  }
  const sorted = [...bins].sort((a, b) => a - b)
  const sum = bins.reduce((a, b) => a + b, 0)
  const mean = sum / nFrames
  const p95 = sorted[Math.floor(sorted.length * 0.95)]
  const max = sorted[sorted.length - 1]
  const top = bins
    .map((c, i) => ({ i, c, t: tMin2 + i * frame }))
    .sort((a, b) => b.c - a.c)
    .slice(0, 8)
  let overlapCount = 0
  for (const s of source) if (s.t >= 7000 && s.t <= tMax2) overlapCount++
  return { fps, nFrames, mean, p95, max, top, overlapCount, overlapSpan: Math.max(0, tMax2 - 7000) }
}

console.log('colorLayer paths:', items.length)
console.log('bands:', byBand, '| base(.bs transition) =', nb)
console.log(`schedule: START=${START}ms DUR=${DUR}ms  paint ${tMin.toFixed(0)}..${tMax.toFixed(0)}ms`)
console.log('note: assets/intro.html 现采用 band-uniform 排期；下方同时给出旧版 k-based 对照。')

for (const band of ['base', 'subject', 'environment']) {
  const ts = shapes.filter((s) => s.band === band).map((s) => s.t)
  console.log(`  ${band.padEnd(11)} ${String(ts.length).padStart(5)} paths  ${Math.min(...ts).toFixed(0)}..${Math.max(...ts).toFixed(0)}ms`)
}

const uniform = scheduleBandUniform()
for (const fps of [60, 30]) {
  const cur = analyze(fps, shapes)
  const uni = analyze(fps, uniform)
  console.log(`\n--- ${fps}fps (frame=${(1000 / fps).toFixed(2)}ms) ---`)
  console.log(`legacy(k-based) : frames=${cur.nFrames} mean=${cur.mean.toFixed(1)} p95=${cur.p95} max=${cur.max} burst=${(cur.max / cur.mean).toFixed(2)}x  overlap@7s=${cur.overlapCount}/${cur.overlapSpan.toFixed(0)}ms`)
  console.log(`band-uniform    : frames=${uni.nFrames} mean=${uni.mean.toFixed(1)} p95=${uni.p95} max=${uni.max} burst=${(uni.max / uni.mean).toFixed(2)}x  overlap@7s=${uni.overlapCount}/${uni.overlapSpan.toFixed(0)}ms`)
  console.log('  legacy top : ' + cur.top.map((x) => `f${x.i}@${x.t.toFixed(0)}=${x.c}`).join(' '))
  console.log('  uniform top: ' + uni.top.map((x) => `f${x.i}@${x.t.toFixed(0)}=${x.c}`).join(' '))
}
