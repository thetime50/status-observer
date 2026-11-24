/**
 * FlashDuty Status Page API 封装：鉴权请求、按名称解析/创建组件、开故障与恢复。
 */

/**
 * @param {string} apiBase
 * @param {string} statusKey
 * @param {string} path
 * @param {{ method?: string, body?: unknown, query?: Record<string, string | number> }} [opts]
 */
export async function flashduty(apiBase, statusKey, path, opts = {}) {
  const url = new URL(path, apiBase.endsWith('/') ? apiBase : `${apiBase}/`)
  url.searchParams.set('app_key', statusKey)
  for (const [key, value] of Object.entries(opts.query || {})) {
    url.searchParams.set(key, String(value))
  }
  const method = opts.method || (opts.body === undefined ? 'GET' : 'POST')
  /** @type {Record<string, string>} */
  const headers = {
    'Fd-App-Key': statusKey,
    'Accept-Language': 'zh-CN',
  }
  let body
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  const res = await fetch(url, { method, headers, body })
  const raw = await res.text()
  let json
  try {
    json = raw ? JSON.parse(raw) : {}
  } catch {
    throw new Error(`Flashduty 非 JSON 响应 HTTP ${res.status}: ${raw.slice(0, 200)}`)
  }
  if (!res.ok || json.error) {
    const code = json.error?.code || `HTTP_${res.status}`
    const message = json.error?.message || raw.slice(0, 200) || res.statusText
    throw new Error(`Flashduty ${code}: ${message}`)
  }
  return json.data
}

/**
 * @param {string} apiBase
 * @param {string} statusKey
 * @param {number} pageId
 * @param {string} statusName
 */
export async function resolveComponentId(apiBase, statusKey, pageId, statusName) {
  const data = await flashduty(apiBase, statusKey, '/status-page/info', {
    method: 'GET',
    query: { page_id: pageId },
  })
  const components = data?.components || []
  const hit = components.find((c) => c.name === statusName)
  if (hit?.component_id) return String(hit.component_id)

  const created = await flashduty(apiBase, statusKey, '/status-page/component/upsert', {
    method: 'POST',
    body: {
      page_id: pageId,
      components: [
        {
          name: statusName,
          description: 'cloud-dsh status-observer 自动创建',
        },
      ],
    },
  })
  const id = created?.component_ids?.[0]
  if (!id) throw new Error(`创建组件「${statusName}」失败`)
  return String(id)
}

/**
 * @param {object} p
 * @param {string} p.apiBase
 * @param {string} p.statusKey
 * @param {number} p.pageId
 * @param {string} p.componentId
 * @param {string} p.title
 * @param {string} p.description
 * @param {boolean} p.notifySubscribers
 */
export async function createIncident(p) {
  const now = Math.floor(Date.now() / 1000)
  const data = await flashduty(p.apiBase, p.statusKey, '/status-page/change/create', {
    method: 'POST',
    body: {
      page_id: p.pageId,
      type: 'incident',
      title: p.title.slice(0, 255),
      description: p.description,
      status: 'investigating',
      notify_subscribers: p.notifySubscribers,
      updates: [
        {
          status: 'investigating',
          description: p.description,
          at_seconds: now,
          component_changes: [
            { component_id: p.componentId, status: 'full_outage' },
          ],
        },
      ],
    },
  })
  return data?.change_id
}

/**
 * @param {object} p
 * @param {string} p.apiBase
 * @param {string} p.statusKey
 * @param {number} p.pageId
 * @param {number|string} p.changeId
 * @param {string} p.componentId
 * @param {string} p.description
 */
export async function resolveIncident(p) {
  await flashduty(p.apiBase, p.statusKey, '/status-page/change/timeline/create', {
    method: 'POST',
    body: {
      page_id: p.pageId,
      change_id: Number(p.changeId),
      status: 'resolved',
      description: p.description,
      at_seconds: Math.floor(Date.now() / 1000),
      component_changes: [
        { component_id: p.componentId, status: 'operational' },
      ],
    },
  })
}
