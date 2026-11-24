/**
 * status-v2 只读 BFF：读 kuma.db，不改 Kuma。
 * GET /status-v2/api/beats/:id?period=0|3|6|24|168
 * GET /status-v2/api/beats/:id?from=YYYY-MM-DD&to=YYYY-MM-DD
 * GET /status-v2/api/anomaly-days/:id?year=2026&month=11
 * GET /status-v2/api/events/:id?day=YYYY-MM-DD
 */
import http from 'node:http'
import { DatabaseSync } from 'node:sqlite'

const PORT = Number(process.env.PORT || 3100)
const KUMA_DB = process.env.KUMA_DB || '/data/kuma.db'
const MAX_BEATS = 5000

function pad(n) {
  return String(n).padStart(2, '0')
}

function formatKumaTime(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${String(d.getUTCMilliseconds()).padStart(3, '0')}`
}

function openDb() {
  return new DatabaseSync(KUMA_DB, { readOnly: true })
}

function json(res, status, body) {
  const raw = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(raw)
}

function parsePath(url) {
  const u = new URL(url, 'http://local')
  return { pathname: u.pathname, searchParams: u.searchParams }
}

function fetchBeatsByRange(db, monitorId, fromStr, toStr) {
  const rows = db
    .prepare(
      `SELECT status, time, msg, ping
       FROM heartbeat
       WHERE monitor_id = ?
         AND time >= ?
         AND time <= ?
       ORDER BY time ASC
       LIMIT ?`,
    )
    .all(monitorId, fromStr, toStr, MAX_BEATS)
  return rows.map((r) => ({
    status: r.status,
    time: r.time,
    msg: r.msg || '',
    ping: r.ping,
  }))
}

function fetchBeatsByPeriod(db, monitorId, periodHours) {
  if (!periodHours) {
    const rows = db
      .prepare(
        `SELECT status, time, msg, ping
         FROM heartbeat
         WHERE monitor_id = ?
         ORDER BY time DESC
         LIMIT 100`,
      )
      .all(monitorId)
    return rows.reverse().map((r) => ({
      status: r.status,
      time: r.time,
      msg: r.msg || '',
      ping: r.ping,
    }))
  }
  const from = new Date(Date.now() - periodHours * 3600 * 1000)
  const to = new Date()
  return fetchBeatsByRange(db, monitorId, formatKumaTime(from), formatKumaTime(to))
}

/** Date.getTimezoneOffset()：UTC+8 为 -480。缺省按 UTC。 */
function readTzOffset(searchParams) {
  const raw = searchParams.get('tzOffset')
  if (raw == null || raw === '') return 0
  const n = Number(raw)
  if (!Number.isFinite(n) || n < -840 || n > 840) return 0
  return Math.trunc(n)
}

function isDay(day) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day || '')
}

/** 本地日 [00:00, 23:59:59.999] → 库内 UTC 字符串 */
function localDayToUtcRange(day, tzOffsetMin) {
  const [y, m, d] = day.split('-').map(Number)
  const shift = tzOffsetMin * 60_000
  const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) + shift)
  const end = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) + shift)
  return { start: formatKumaTime(start), end: formatKumaTime(end) }
}

function utcTimeToLocalDay(timeStr, tzOffsetMin) {
  const ms = Date.parse(String(timeStr).replace(' ', 'T') + 'Z') - tzOffsetMin * 60_000
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function localMonthUtcBounds(year, month, tzOffsetMin) {
  const start = localDayToUtcRange(`${year}-${pad(month)}-01`, tzOffsetMin).start
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  const next = localDayToUtcRange(`${nextYear}-${pad(nextMonth)}-01`, tzOffsetMin).start
  return { start, next }
}

function fetchAnomalyDays(db, monitorId, year, month, tzOffsetMin) {
  const { start, next } = localMonthUtcBounds(year, month, tzOffsetMin)
  const rows = db
    .prepare(
      `SELECT time
       FROM heartbeat
       WHERE monitor_id = ?
         AND status != 1
         AND time >= ?
         AND time < ?`,
    )
    .all(monitorId, start, next)
  return [...new Set(rows.map((r) => utcTimeToLocalDay(r.time, tzOffsetMin)))]
}

/** 当月有任意心跳记录的日期（含正常） */
function fetchDataDays(db, monitorId, year, month, tzOffsetMin) {
  const { start, next } = localMonthUtcBounds(year, month, tzOffsetMin)
  const rows = db
    .prepare(
      `SELECT time
       FROM heartbeat
       WHERE monitor_id = ?
         AND time >= ?
         AND time < ?`,
    )
    .all(monitorId, start, next)
  return [...new Set(rows.map((r) => utcTimeToLocalDay(r.time, tzOffsetMin)))]
}

function fetchDayEvents(db, monitorId, day, tzOffsetMin) {
  const { start, end } = localDayToUtcRange(day, tzOffsetMin)
  const rows = db
    .prepare(
      `SELECT status, time, msg, important
       FROM heartbeat
       WHERE monitor_id = ?
         AND status != 1
         AND time >= ?
         AND time <= ?
       ORDER BY time ASC
       LIMIT 200`,
    )
    .all(monitorId, start, end)
  return rows.map((r) => ({
    status: r.status,
    time: r.time,
    msg: r.msg || '',
    important: r.important,
  }))
}

const server = http.createServer((req, res) => {
  try {
    if (req.method !== 'GET') {
      json(res, 405, { ok: false, msg: 'method not allowed' })
      return
    }
    const { pathname, searchParams } = parsePath(req.url || '/')

    let m = pathname.match(/^\/status-v2\/api\/beats\/(\d+)$/)
    if (m) {
      const monitorId = Number(m[1])
      const db = openDb()
      try {
        const from = searchParams.get('from')
        const to = searchParams.get('to')
        let beats
        if (from && to) {
          if (!isDay(from) || !isDay(to)) {
            json(res, 400, { ok: false, msg: 'from/to=YYYY-MM-DD required' })
            return
          }
          const tzOffset = readTzOffset(searchParams)
          const start = localDayToUtcRange(from, tzOffset).start
          const end = localDayToUtcRange(to, tzOffset).end
          beats = fetchBeatsByRange(db, monitorId, start, end)
        } else {
          const period = Number(searchParams.get('period') || '0')
          beats = fetchBeatsByPeriod(db, monitorId, period)
        }
        json(res, 200, { ok: true, monitorId, beats })
      } finally {
        db.close()
      }
      return
    }

    m = pathname.match(/^\/status-v2\/api\/anomaly-days\/(\d+)$/)
    if (m) {
      const monitorId = Number(m[1])
      const year = Number(searchParams.get('year'))
      const month = Number(searchParams.get('month'))
      if (!year || !month || month < 1 || month > 12) {
        json(res, 400, { ok: false, msg: 'year/month required' })
        return
      }
      const db = openDb()
      try {
        const tzOffset = readTzOffset(searchParams)
        const days = fetchAnomalyDays(db, monitorId, year, month, tzOffset)
        const dataDays = fetchDataDays(db, monitorId, year, month, tzOffset)
        json(res, 200, { ok: true, monitorId, year, month, days, dataDays })
      } finally {
        db.close()
      }
      return
    }

    m = pathname.match(/^\/status-v2\/api\/events\/(\d+)$/)
    if (m) {
      const monitorId = Number(m[1])
      const day = searchParams.get('day')
      if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        json(res, 400, { ok: false, msg: 'day=YYYY-MM-DD required' })
        return
      }
      const db = openDb()
      try {
        const events = fetchDayEvents(db, monitorId, day, readTzOffset(searchParams))
        json(res, 200, { ok: true, monitorId, day, total: events.length, events })
      } finally {
        db.close()
      }
      return
    }

    json(res, 404, { ok: false, msg: 'not found' })
  } catch (err) {
    json(res, 500, { ok: false, msg: String(err?.message || err) })
  }
})

server.listen(PORT, () => {
  console.log(`status-v2-api on :${PORT} db=${KUMA_DB}`)
})
