export function bind(site, channel) {
  const base = String(channel?.baseurl || '').replace(/\/$/, '')
  if (!base) throw new Error(`渠道 ${channel?.id || ''} 没有 baseurl`)
  const rel = site.path.startsWith('/') ? site.path : `/${site.path}`
  return {
    name: site.name,
    url: base + rel,
    method: site.method || 'GET',
    keyword: site.keyword,
    expectedCodes: site.expectedCodes,
    timeoutMs: site.timeoutMs ?? 10000,
  }
}

export function custom(item) {
  if (!item?.url) throw new Error(`自定义项 ${item?.name || ''} 没有 url`)
  return {
    name: item.name,
    url: item.url,
    method: item.method || 'GET',
    keyword: item.keyword,
    expectedCodes: item.expectedCodes,
    timeoutMs: item.timeoutMs ?? 10000,
  }
}

export function flareId(name) {
  const id = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
  return id || 'monitor'
}

export function toKumaRow(item, interval) {
  const row = {
    name: item.name,
    active: 1,
    interval,
    url: item.url,
    type: item.keyword ? 'keyword' : 'http',
    maxretries: 0,
    ignore_tls: 0,
    upside_down: 0,
    maxredirects: 10,
    accepted_statuscodes_json: JSON.stringify(statusCodes(item.expectedCodes)),
    retry_interval: interval,
    method: item.method || 'GET',
    expiry_notification: 0,
    timeout: Math.max(1, Math.round((item.timeoutMs ?? 10000) / 1000)),
  }
  if (item.keyword) {
    row.keyword = item.keyword
    row.invert_keyword = 0
  }
  return row
}

function statusCodes(codes) {
  if (!codes?.length) return ['200-299']
  return codes.map((code) => String(code))
}

export function toFlareEntry(item) {
  const entry = {
    id: flareId(item.name),
    name: item.name,
    method: item.method || 'GET',
    target: item.url,
    timeout: item.timeoutMs ?? 10000,
    headers: { 'User-Agent': 'Uptimeflare' },
  }
  if (item.expectedCodes?.length) entry.expectedCodes = item.expectedCodes
  if (item.keyword) entry.responseKeyword = item.keyword
  return entry
}
