const UP = 1
const DOWN = 0
const PENDING = 2
const MAINTENANCE = 3

const PERIOD_OPTIONS = [
  { value: '0', label: '最近' },
  { value: '3', label: '3h' },
  { value: '6', label: '6h' },
  { value: '24', label: '24h' },
  { value: '168', label: '1w' },
]

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六']

function resolveSlug() {
  const params = new URLSearchParams(location.search)
  if (params.get('slug')) return params.get('slug')
  const parts = location.pathname.replace(/\/+$/, '').split('/')
  const idx = parts.lastIndexOf('status-v2')
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1]
  return 'tunnel-pst'
}

function statusLabel(status) {
  if (status === UP) return { text: 'UP', className: 'up' }
  if (status === DOWN) return { text: 'DOWN', className: 'down' }
  if (status === PENDING) return { text: 'PENDING', className: 'pending' }
  if (status === MAINTENANCE) return { text: 'MAINT', className: 'maint' }
  return { text: 'N/A', className: 'pending' }
}

function parseBeatTime(time) {
  if (typeof time === 'number') return new Date(time)
  if (/^\d{4}-\d{2}-\d{2} /.test(time)) return new Date(time.replace(' ', 'T') + 'Z')
  return new Date(time)
}

function formatUptime(v) {
  if (v == null || Number.isNaN(v)) return '—'
  return `${(v * 100).toFixed(2)}%`
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function dayKey(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function buildHeartbeatBar(beats) {
  const bar = document.createElement('div')
  bar.className = 'heartbeat-bar'
  const slice = beats.slice(-48)
  for (const beat of slice) {
    const span = document.createElement('span')
    const info = statusLabel(beat.status)
    span.className = info.className
    span.title = `${beat.time} · ${beat.ping ?? '—'} ms · ${beat.msg || info.text}`
    bar.appendChild(span)
  }
  return bar
}

function buildRecentChartData(beats) {
  const pingData = []
  const downData = []
  const colorData = []

  for (const beat of beats) {
    const x = parseBeatTime(beat.time)
    pingData.push({ x, y: beat.status === UP ? beat.ping : null })
    downData.push({
      x,
      y: beat.status === DOWN || beat.status === MAINTENANCE || beat.status === PENDING ? 1 : 0,
    })
    if (beat.status === MAINTENANCE) colorData.push('rgba(23,71,245,0.41)')
    else if (beat.status === PENDING) colorData.push('rgba(245,182,23,0.41)')
    else colorData.push('rgba(220,53,69,0.41)')
  }

  return {
    datasets: [
      {
        type: 'line',
        data: pingData,
        fill: 'origin',
        tension: 0.2,
        borderColor: '#4ABF74',
        backgroundColor: '#4ABF7438',
        yAxisID: 'y',
        label: 'avgPing',
        pointRadius: 0,
        pointHitRadius: 8,
      },
      {
        type: 'bar',
        data: downData,
        borderColor: '#00000000',
        backgroundColor: colorData,
        yAxisID: 'y1',
        label: 'status',
        barPercentage: 1,
        categoryPercentage: 1,
      },
    ],
  }
}

function clientTzOffset() {
  return new Date().getTimezoneOffset()
}

async function fetchBeats(monitorId, { period, from, to } = {}) {
  const q = new URLSearchParams()
  if (from && to) {
    q.set('from', from)
    q.set('to', to)
    q.set('tzOffset', String(clientTzOffset()))
  } else {
    q.set('period', String(period ?? 0))
  }
  const res = await fetch(`/status-v2/api/beats/${monitorId}?${q}`)
  if (!res.ok) throw new Error(`beats ${res.status}`)
  const data = await res.json()
  if (!data.ok) throw new Error(data.msg || 'beats failed')
  return data.beats || []
}

async function fetchAnomalyDays(monitorId, year, month) {
  const q = new URLSearchParams({
    year: String(year),
    month: String(month),
    tzOffset: String(clientTzOffset()),
  })
  const res = await fetch(`/status-v2/api/anomaly-days/${monitorId}?${q}`)
  if (!res.ok) throw new Error(`anomaly-days ${res.status}`)
  const data = await res.json()
  if (!data.ok) throw new Error(data.msg || 'anomaly-days failed')
  return {
    anomaly: new Set(data.days || []),
    dataDays: new Set(data.dataDays || []),
  }
}

async function fetchDayEvents(monitorId, day) {
  const q = new URLSearchParams({ day, tzOffset: String(clientTzOffset()) })
  const res = await fetch(`/status-v2/api/events/${monitorId}?${q}`)
  if (!res.ok) throw new Error(`events ${res.status}`)
  const data = await res.json()
  if (!data.ok) throw new Error(data.msg || 'events failed')
  return data
}

function eventShortLabel(status) {
  if (status === DOWN) return '探测失败'
  if (status === PENDING) return '等待中'
  if (status === MAINTENANCE) return '维护中'
  return '异常'
}

function formatDayTitle(day) {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const week = WEEKDAY_CN[dt.getUTCDay()]
  return `${y}年${m}月${d}日星期${week}`
}

function todayKey() {
  const now = new Date()
  return dayKey(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

function createMonitorController(monitor, initialBeats, uptimeList) {
  const state = {
    monitorId: monitor.id,
    period: '0',
    beats: initialBeats,
    chart: null,
    rangeStart: null,
    rangeEnd: null,
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth() + 1,
    anomalyCache: new Map(),
    eventCache: new Map(),
    calendarLoaded: false,
  }

  const el = document.createElement('article')
  el.className = 'monitor'

  const last = initialBeats[initialBeats.length - 1]
  const status = statusLabel(last?.status)
  const uptime = uptimeList[`${monitor.id}_24`]

  el.innerHTML = `
    <div class="monitor-head">
      <div class="monitor-name">${escapeHtml(monitor.name)}</div>
      <span class="badge ${status.className}">${status.text}</span>
    </div>
    <div class="stats-row">
      <span>24h uptime: ${formatUptime(uptime)}</span>
      <span class="stat-ping">last ping: ${last?.ping ?? '—'} ms</span>
      <span class="stat-beats">beats: ${initialBeats.length}</span>
      <span class="stat-mode">chart: recent</span>
    </div>
  `
  const barHost = document.createElement('div')
  barHost.className = 'bar-host'
  barHost.appendChild(buildHeartbeatBar(initialBeats))
  el.appendChild(barHost)

  const wrapper = document.createElement('div')
  wrapper.className = 'shadow-box big-padding text-center ping-chart-wrapper'
  wrapper.innerHTML = `
    <div class="period-options">
      <label class="period-label">
        <span class="period-current"></span>
        <select class="period-select" aria-label="chart period"></select>
      </label>
    </div>
    <p class="chart-caption">PingChart（下拉对齐后台；日历范围可覆盖）</p>
    <div class="chart-wrap"><canvas></canvas></div>
  `
  el.appendChild(wrapper)

  const select = wrapper.querySelector('.period-select')
  const periodCurrent = wrapper.querySelector('.period-current')
  for (const opt of PERIOD_OPTIONS) {
    const o = document.createElement('option')
    o.value = opt.value
    o.textContent = opt.label
    select.appendChild(o)
  }
  const customOpt = document.createElement('option')
  customOpt.value = 'custom'
  customOpt.textContent = '自定义'
  customOpt.disabled = true
  select.appendChild(customOpt)

  const canvas = wrapper.querySelector('canvas')

  const calendar = document.createElement('details')
  calendar.className = 'event-calendar-card'
  calendar.innerHTML = `
    <summary class="event-calendar-summary">
      <span>事件日历</span>
      <span class="event-calendar-hint" aria-hidden="true">‹</span>
    </summary>
    <div class="event-calendar-body">
      <div class="event-calendar-toolbar">
        <button type="button" class="cal-nav" data-dir="-1" aria-label="上一月">‹</button>
        <span class="cal-title"></span>
        <button type="button" class="cal-nav" data-dir="1" aria-label="下一月">›</button>
        <button type="button" class="cal-today-btn">今天</button>
      </div>
      <div class="cal-range-hint">点击选择起止日期，范围联动上方图表</div>
      <div class="cal-weekdays"></div>
      <div class="cal-grid"></div>
      <div class="cal-status"></div>
      <div class="cal-popover" hidden></div>
    </div>
  `
  el.appendChild(calendar)

  const calTitle = calendar.querySelector('.cal-title')
  const calGrid = calendar.querySelector('.cal-grid')
  const calStatus = calendar.querySelector('.cal-status')
  const calPopover = calendar.querySelector('.cal-popover')
  const weekdays = calendar.querySelector('.cal-weekdays')
  for (const w of WEEKDAYS) {
    const d = document.createElement('div')
    d.textContent = w
    weekdays.appendChild(d)
  }

  let popoverHideTimer = null

  function hidePopover() {
    clearTimeout(popoverHideTimer)
    popoverHideTimer = null
    calPopover.hidden = true
    calPopover.innerHTML = ''
  }

  function scheduleHidePopover() {
    clearTimeout(popoverHideTimer)
    popoverHideTimer = setTimeout(hidePopover, 160)
  }

  function cancelHidePopover() {
    clearTimeout(popoverHideTimer)
    popoverHideTimer = null
  }

  async function showAnomalyPopover(cell, day) {
    cancelHidePopover()
    calPopover.hidden = false
    calPopover.innerHTML = `<div class="cal-popover-card">加载中…</div>`
    const rect = cell.getBoundingClientRect()
    const bodyRect = calendar.querySelector('.event-calendar-body').getBoundingClientRect()
    calPopover.style.left = `${Math.min(Math.max(8, rect.left - bodyRect.left + rect.width / 2 - 120), bodyRect.width - 248)}px`
    calPopover.style.top = `${rect.bottom - bodyRect.top + 4}px`

    try {
      let data = state.eventCache.get(day)
      if (!data) {
        data = await fetchDayEvents(state.monitorId, day)
        state.eventCache.set(day, data)
      }
      const total = data.total || data.events?.length || 0
      const list = (data.events || []).slice(0, 5)
      const hidden = Math.max(0, total - list.length)
      const lines = list
        .map((ev) => `<li>${escapeHtml(monitor.name)}: ${escapeHtml(eventShortLabel(ev.status))}</li>`)
        .join('')
      calPopover.innerHTML = `
        <div class="cal-popover-card">
          <div class="cal-popover-title">${escapeHtml(formatDayTitle(day))} 共 ${total} 条事件</div>
          <ul class="cal-popover-list">${lines || '<li>无事件</li>'}</ul>
          ${hidden > 0 ? `<div class="cal-popover-more">隐藏其他${hidden}条 详情见后台</div>` : ''}
        </div>
      `
    } catch (err) {
      calPopover.innerHTML = `<div class="cal-popover-card">加载失败：${escapeHtml(err.message)}</div>`
    }
  }

  function setModeLabel() {
    const mode = el.querySelector('.stat-mode')
    const beatsEl = el.querySelector('.stat-beats')
    if (state.rangeStart && state.rangeEnd) {
      mode.textContent = `chart: ${state.rangeStart} → ${state.rangeEnd}`
      periodCurrent.textContent = '自定义'
      select.value = 'custom'
    } else {
      const label = PERIOD_OPTIONS.find((p) => p.value === state.period)?.label || 'recent'
      mode.textContent = `chart: ${label}`
      periodCurrent.textContent = label
      select.value = state.period
    }
    beatsEl.textContent = `beats: ${state.beats.length}`
  }

  function renderChart(beats) {
    if (state.chart) state.chart.destroy()
    state.chart = new Chart(canvas, {
      type: 'line',
      data: buildRecentChartData(beats),
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: (item) => item.dataset.type !== 'bar',
            callbacks: {
              label: (ctx) => {
                const y = ctx.parsed.y
                return y == null ? '' : `ping ${y} ms`
              },
            },
          },
        },
        scales: {
          x: {
            type: 'time',
            time: {
              tooltipFormat: 'yyyy-MM-dd HH:mm:ss',
              displayFormats: { minute: 'HH:mm', hour: 'MM-dd HH:mm' },
            },
            ticks: { maxRotation: 0, autoSkipPadding: 24 },
            grid: { color: 'rgba(0,0,0,0.08)' },
          },
          y: {
            title: { display: true, text: 'Response (ms)' },
            grid: { color: 'rgba(0,0,0,0.08)' },
          },
          y1: {
            display: false,
            position: 'right',
            min: 0,
            max: 1,
            grid: { drawOnChartArea: false },
          },
        },
      },
    })
  }

  function refreshBar() {
    barHost.replaceChildren(buildHeartbeatBar(state.beats))
  }

  async function applyBeats(beats) {
    state.beats = beats
    renderChart(beats)
    refreshBar()
    setModeLabel()
  }

  async function loadPeriod(period) {
    calStatus.textContent = '加载图表…'
    try {
      const beats = await fetchBeats(state.monitorId, { period: Number(period) })
      state.period = String(period)
      state.rangeStart = null
      state.rangeEnd = null
      customOpt.disabled = true
      await applyBeats(beats)
      renderCalendarGrid()
      calStatus.textContent = ''
    } catch (err) {
      calStatus.textContent = `图表加载失败：${err.message}`
    }
  }

  async function loadRange(from, to) {
    calStatus.textContent = '按日期范围加载…'
    try {
      const beats = await fetchBeats(state.monitorId, { from, to })
      state.rangeStart = from
      state.rangeEnd = to
      customOpt.disabled = false
      await applyBeats(beats)
      renderCalendarGrid()
      calStatus.textContent = `已联动：${from} ~ ${to}（${beats.length} 点）`
    } catch (err) {
      calStatus.textContent = `范围加载失败：${err.message}`
    }
  }

  function inSelectedRange(key) {
    if (!state.rangeStart) return false
    if (!state.rangeEnd) return key === state.rangeStart
    return key >= state.rangeStart && key <= state.rangeEnd
  }

  async function ensureAnomalyDays() {
    const key = `${state.calYear}-${state.calMonth}`
    if (state.anomalyCache.has(key)) return state.anomalyCache.get(key)
    calStatus.textContent = '加载日历数据…'
    const meta = await fetchAnomalyDays(state.monitorId, state.calYear, state.calMonth)
    state.anomalyCache.set(key, meta)
    const a = meta.anomaly.size
    const d = meta.dataDays.size
    calStatus.textContent = a
      ? `本月有数据 ${d} 天 · 异常 ${a} 天`
      : d
        ? `本月有数据 ${d} 天 · 无异常`
        : '本月无数据'
    return meta
  }

  function renderCalendarGrid() {
    hidePopover()
    calTitle.textContent = `${state.calYear}年${state.calMonth}月`
    const meta = state.anomalyCache.get(`${state.calYear}-${state.calMonth}`) || {
      anomaly: new Set(),
      dataDays: new Set(),
    }
    const anomaly = meta.anomaly
    const dataDays = meta.dataDays
    const today = todayKey()
    const first = new Date(Date.UTC(state.calYear, state.calMonth - 1, 1))
    // Monday-first index
    const jsDay = first.getUTCDay()
    const mondayIndex = (jsDay + 6) % 7
    const daysInMonth = new Date(Date.UTC(state.calYear, state.calMonth, 0)).getUTCDate()
    const prevDays = new Date(Date.UTC(state.calYear, state.calMonth - 1, 0)).getUTCDate()

    calGrid.replaceChildren()
    const totalCells = Math.ceil((mondayIndex + daysInMonth) / 7) * 7
    for (let i = 0; i < totalCells; i++) {
      const cell = document.createElement('button')
      cell.type = 'button'
      cell.className = 'cal-day'

      let y = state.calYear
      let m = state.calMonth
      let d
      let outside = false
      if (i < mondayIndex) {
        outside = true
        d = prevDays - mondayIndex + i + 1
        m = state.calMonth - 1
        if (m < 1) {
          m = 12
          y -= 1
        }
      } else if (i >= mondayIndex + daysInMonth) {
        outside = true
        d = i - (mondayIndex + daysInMonth) + 1
        m = state.calMonth + 1
        if (m > 12) {
          m = 1
          y += 1
        }
      } else {
        d = i - mondayIndex + 1
      }

      const key = dayKey(y, m, d)
      cell.dataset.day = key
      if (outside) cell.classList.add('outside')
      if (inSelectedRange(key)) cell.classList.add('in-range')
      if (state.rangeStart === key) cell.classList.add('range-start')
      if (state.rangeEnd === key || (state.rangeStart === key && !state.rangeEnd)) {
        cell.classList.add('range-end')
      }

      const inner = document.createElement('span')
      inner.className = 'cal-day-inner'
      inner.textContent = String(d)
      cell.appendChild(inner)

      if (!outside && dataDays.has(key)) {
        cell.classList.add('has-data')
      }

      if (!outside && key === today) {
        cell.classList.add('is-today')
        const dot = document.createElement('span')
        dot.className = 'cal-today-dot'
        cell.appendChild(dot)
      }

      if (!outside && anomaly.has(key)) {
        const ring = document.createElement('span')
        ring.className = 'cal-anomaly-ring'
        cell.appendChild(ring)
        cell.classList.add('has-anomaly')
        cell.addEventListener('mouseenter', () => showAnomalyPopover(cell, key))
        cell.addEventListener('mouseleave', scheduleHidePopover)
      }

      if (!outside) {
        cell.addEventListener('click', () => onDayClick(key))
      } else {
        cell.disabled = true
      }
      calGrid.appendChild(cell)
    }
  }

  calPopover.addEventListener('mouseenter', cancelHidePopover)
  calPopover.addEventListener('mouseleave', scheduleHidePopover)

  async function onDayClick(key) {
    if (!state.rangeStart || (state.rangeStart && state.rangeEnd)) {
      state.rangeStart = key
      state.rangeEnd = null
      renderCalendarGrid()
      calStatus.textContent = `已选开始：${key}，再选结束日期`
      return
    }
    if (key < state.rangeStart) {
      state.rangeStart = key
      state.rangeEnd = null
      renderCalendarGrid()
      calStatus.textContent = `已选开始：${key}，再选结束日期`
      return
    }
    await loadRange(state.rangeStart, key)
  }

  select.addEventListener('change', () => {
    if (select.value === 'custom') return
    loadPeriod(select.value)
  })

  async function gotoMonth(year, month) {
    state.calYear = year
    state.calMonth = month
    try {
      await ensureAnomalyDays()
      renderCalendarGrid()
    } catch (err) {
      calStatus.textContent = err.message
    }
  }

  calendar.querySelectorAll('.cal-nav').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault()
      const dir = Number(btn.dataset.dir)
      let month = state.calMonth + dir
      let year = state.calYear
      if (month < 1) {
        month = 12
        year -= 1
      } else if (month > 12) {
        month = 1
        year += 1
      }
      await gotoMonth(year, month)
    })
  })

  calendar.querySelector('.cal-today-btn').addEventListener('click', async (e) => {
    e.preventDefault()
    const now = new Date()
    await gotoMonth(now.getFullYear(), now.getMonth() + 1)
    const today = todayKey()
    const cell = calGrid.querySelector(`button.cal-day[data-day="${today}"]`)
    if (cell) cell.focus()
  })

  calendar.addEventListener('toggle', async () => {
    if (!calendar.open) {
      hidePopover()
      return
    }
    try {
      await ensureAnomalyDays()
      state.calendarLoaded = true
      renderCalendarGrid()
    } catch (err) {
      calStatus.textContent = `日历加载失败：${err.message}`
    }
  })

  // initial chart from public recent beats (already have)
  applyBeats(initialBeats)
  setModeLabel()

  return el
}

async function main() {
  const slug = resolveSlug()
  const titleEl = document.getElementById('title')
  const metaEl = document.getElementById('meta')
  const groupsEl = document.getElementById('groups')
  const errorEl = document.getElementById('error')
  const incidentEl = document.getElementById('incident')

  try {
    const [pageRes, beatRes] = await Promise.all([
      fetch(`/api/status-page/${encodeURIComponent(slug)}`),
      fetch(`/api/status-page/heartbeat/${encodeURIComponent(slug)}`),
    ])
    if (!pageRes.ok) throw new Error(`status-page ${pageRes.status}`)
    if (!beatRes.ok) throw new Error(`heartbeat ${beatRes.status}`)

    const page = await pageRes.json()
    const beats = await beatRes.json()

    document.title = `${page.config?.title || slug} · Status v2`
    titleEl.textContent = page.config?.title || slug
    metaEl.textContent = `slug: ${slug} · 周期下拉 + 事件日历联动图表`

    if (page.incident) {
      incidentEl.hidden = false
      incidentEl.textContent = page.incident.title || page.incident.content || 'Incident'
    }

    groupsEl.replaceChildren()
    for (const group of page.publicGroupList || []) {
      const section = document.createElement('section')
      section.className = 'group'
      const h2 = document.createElement('h2')
      h2.textContent = group.name || 'Monitors'
      section.appendChild(h2)
      for (const monitor of group.monitorList || []) {
        const list = beats.heartbeatList?.[String(monitor.id)] || []
        section.appendChild(createMonitorController(monitor, list, beats.uptimeList || {}))
      }
      groupsEl.appendChild(section)
    }
  } catch (err) {
    errorEl.hidden = false
    errorEl.textContent = `加载失败：${err.message}`
    titleEl.textContent = 'Status v2'
  }
}

main()
