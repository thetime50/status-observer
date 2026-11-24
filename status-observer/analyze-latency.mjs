/**
 * 离线分析 UptimeFlare 状态页延迟数据：对比 tunnel vs PST 等监控的均值/分位/尖刺。
 * 输入：playwright 导出的 uptimeflare-latency-raw.json；输出：uptimeflare-latency-stats.json。
 * 用法：node analyze-latency.mjs
 */
import fs from 'node:fs'

const raw = JSON.parse(
  fs.readFileSync('C:/Users/holid/.playwright-mcp/uptimeflare-latency-raw.json', 'utf8'),
)
const monitors = raw.monitors || []

function stats(arr) {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const sum = s.reduce((a, b) => a + b, 0)
  const mean = sum / s.length
  const median =
    s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
  const p = (q) => {
    const i = (s.length - 1) * q
    const lo = Math.floor(i)
    const hi = Math.ceil(i)
    return lo === hi ? s[lo] : s[lo] * (hi - i) + s[hi] * (i - lo)
  }
  const variance = s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length
  return {
    n: s.length,
    min: s[0],
    max: s[s.length - 1],
    mean: +mean.toFixed(1),
    median: +median.toFixed(1),
    p90: +p(0.9).toFixed(1),
    p95: +p(0.95).toFixed(1),
    p99: +p(0.99).toFixed(1),
    stdev: +Math.sqrt(variance).toFixed(1),
  }
}

function trimOutliers(arr, method) {
  const s = [...arr].sort((a, b) => a - b)
  if (method === 'iqr') {
    const q = (qq) => {
      const i = (s.length - 1) * qq
      const lo = Math.floor(i)
      const hi = Math.ceil(i)
      return lo === hi ? s[lo] : s[lo] * (hi - i) + s[hi] * (i - lo)
    }
    const q1 = q(0.25)
    const q3 = q(0.75)
    const iqr = q3 - q1
    const lo = q1 - 1.5 * iqr
    const hi = q3 + 1.5 * iqr
    return arr.filter((x) => x >= lo && x <= hi)
  }
  if (method === 'p95cap') {
    const i = (s.length - 1) * 0.95
    const lo = Math.floor(i)
    const hi = Math.ceil(i)
    const p95 = lo === hi ? s[lo] : s[lo] * (hi - i) + s[hi] * (i - lo)
    return arr.filter((x) => x <= p95)
  }
  // dropTop5: keep values <= 95th percentile value
  const cut = s[Math.floor(s.length * 0.95)] ?? s[s.length - 1]
  return arr.filter((x) => x <= cut)
}

const report = []
for (const m of monitors) {
  const pings = m.series.map((x) => x.ping).filter((x) => typeof x === 'number' && x > 0)
  const times = m.series.map((x) => x.t)
  const spanMin = times.length ? (Math.max(...times) - Math.min(...times)) / 60 : 0
  const iqr = trimOutliers(pings, 'iqr')
  const dropTop5 = trimOutliers(pings, 'dropTop5')
  const p95cap = trimOutliers(pings, 'p95cap')
  report.push({
    id: m.id,
    name: m.name,
    points: pings.length,
    spanHours: +(spanMin / 60).toFixed(2),
    first: times.length ? new Date(Math.min(...times) * 1000).toISOString() : null,
    last: times.length ? new Date(Math.max(...times) * 1000).toISOString() : null,
    raw: stats(pings),
    iqrTrim: { removed: pings.length - iqr.length, ...stats(iqr) },
    dropTop5pct: { removed: pings.length - dropTop5.length, ...stats(dropTop5) },
    belowP95: { removed: pings.length - p95cap.length, ...stats(p95cap) },
    over1000: pings.filter((x) => x > 1000).length,
    over2000: pings.filter((x) => x > 2000).length,
    over3000: pings.filter((x) => x > 3000).length,
  })
}

const byId = Object.fromEntries(report.map((r) => [r.id, r]))
const a = byId.cloud_dsh_manage_instances
const b = byId.pst_nav_menu

function cmp(label, ka, kb) {
  if (!ka?.mean || !kb?.mean) return null
  return {
    metric: label,
    tunnel_mean: ka.mean,
    pst_mean: kb.mean,
    tunnel_median: ka.median,
    pst_median: kb.median,
    tunnel_p95: ka.p95,
    pst_p95: kb.p95,
    mean_diff_ms: +(ka.mean - kb.mean).toFixed(1),
    mean_ratio_tunnel_over_pst: +(ka.mean / kb.mean).toFixed(3),
    who_lower_mean: ka.mean < kb.mean ? 'tunnel' : 'pst',
    who_lower_median: ka.median < kb.median ? 'tunnel' : 'pst',
  }
}

function analyzeSeries(series, label) {
  const pings = series.map((x) => x.ping).filter((x) => typeof x === 'number' && x > 0)
  const iqr = trimOutliers(pings, 'iqr')
  return {
    label,
    points: pings.length,
    raw: stats(pings),
    iqrTrim: { removed: pings.length - iqr.length, ...stats(iqr) },
    over1000: pings.filter((x) => x > 1000).length,
    over3000: pings.filter((x) => x > 3000).length,
    timeoutLike: pings.filter((x) => x >= 10000).length,
  }
}

const tunnelSeries = monitors.find((m) => m.id === 'cloud_dsh_manage_instances')?.series || []
const pstSeries = monitors.find((m) => m.id === 'pst_nav_menu')?.series || []
const overlapStart = Math.max(
  Math.min(...tunnelSeries.map((x) => x.t)),
  Math.min(...pstSeries.map((x) => x.t)),
)
const overlapEnd = Math.min(
  Math.max(...tunnelSeries.map((x) => x.t)),
  Math.max(...pstSeries.map((x) => x.t)),
)
const tunnelOverlap = analyzeSeries(
  tunnelSeries.filter((x) => x.t >= overlapStart && x.t <= overlapEnd),
  'tunnel-overlap',
)
const pstOverlap = analyzeSeries(
  pstSeries.filter((x) => x.t >= overlapStart && x.t <= overlapEnd),
  'pst-overlap',
)

const comparison = {
  source: 'https://uptimeflare-56u.pages.dev/',
  targets: {
    tunnel: 'Cloud-DSH-tunnel (trycloudflare)',
    pst: 'PST-nav-menu (pst.thetime50.com)',
  },
  note: '数据来自 UptimeFlare 状态页内嵌 recent latency（约 1 分钟间隔）。主结论用重叠时间窗 + IQR 去极值。',
  fullWindow: {
    raw: cmp('raw', a?.raw, b?.raw),
    iqrTrim: cmp('iqrTrim', a?.iqrTrim, b?.iqrTrim),
  },
  overlapWindow: {
    start: new Date(overlapStart * 1000).toISOString(),
    end: new Date(overlapEnd * 1000).toISOString(),
    hours: +((overlapEnd - overlapStart) / 3600).toFixed(2),
    tunnel: tunnelOverlap,
    pst: pstOverlap,
    raw: cmp('overlap-raw', tunnelOverlap.raw, pstOverlap.raw),
    iqrTrim: cmp('overlap-iqr', tunnelOverlap.iqrTrim, pstOverlap.iqrTrim),
  },
}

const out = { collectedAt: raw.collectedAt, report, comparison }
fs.writeFileSync(
  new URL('./uptimeflare-latency-stats.json', import.meta.url),
  `${JSON.stringify(out, null, 2)}\n`,
)
console.log(JSON.stringify(out, null, 2))
