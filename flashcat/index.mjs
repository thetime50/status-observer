/**
 * FlashDuty 状态页探测主循环：按 config.js 中的 sites 周期性 HTTP 检查，
 * 失败开 incident、恢复后 resolve；支持 --once 只跑一轮。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createIncident, resolveComponentId, resolveIncident } from './flashduty.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const configPath = path.join(__dirname, 'config.js')
const statePath = path.join(__dirname, '.state.json')

if (!fs.existsSync(configPath)) {
  console.error(`缺少 ${configPath}，请复制 config.example.js 为 config.js 并填写密钥`)
  process.exit(1)
}

const { default: config } = await import(pathToFileURL(configPath).href)

/** @returns {{ sites: Record<string, { ok: boolean, changeId: string | number | null }> }} */
function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    if (raw.sites && typeof raw.sites === 'object') return raw
    // 兼容旧版单站点 state
    if ('ok' in raw) {
      return {
        sites: {
          [config.statusName || 'default']: {
            ok: Boolean(raw.ok),
            changeId: raw.changeId ?? null,
          },
        },
      }
    }
  } catch {
    /* empty */
  }
  return { sites: {} }
}

function saveState(state) {
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

/**
 * @param {typeof config} cfg
 */
function resolveSites(cfg) {
  if (Array.isArray(cfg.sites) && cfg.sites.length > 0) return cfg.sites
  return [
    {
      statusName: cfg.statusName,
      testRequests: cfg.testRequests || [],
    },
  ]
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 */
async function probe(url, timeoutMs) {
  const started = Date.now()
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'cloud-dsh-flashcat/0.1' },
    })
    const text = await res.text()
    return { status: res.status, text, ms: Date.now() - started, error: null }
  } catch (error) {
    return {
      status: 0,
      text: '',
      ms: Date.now() - started,
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}

/**
 * @param {typeof config} cfg
 * @param {{ statusName: string, testRequests?: any[] }} site
 * @param {string} componentId
 * @param {{ ok: boolean, changeId: string | number | null }} siteState
 */
async function runOnce(cfg, site, componentId, siteState) {
  /** @type {string[]} */
  const alerts = []
  for (const item of site.testRequests || []) {
    const ctx = await probe(item.url, cfg.timeoutMs || 10_000)
    console.log(
      `[probe][${site.statusName}] ${item.url} status=${ctx.status} ms=${ctx.ms}${ctx.error ? ` err=${ctx.error.message}` : ''}`,
    )
    for (const check of item.checks || []) {
      const result = await check(ctx)
      if (!result || result.ok !== true) {
        alerts.push(result?.message || '检查失败')
      }
    }
  }

  const ok = alerts.length === 0
  const message = ok ? '探测正常' : alerts.join('；')

  if (!ok && siteState.ok) {
    const title = `${site.statusName}: 探测失败`
    const changeId = await createIncident({
      apiBase: cfg.apiBase,
      statusKey: cfg.statusKey,
      pageId: cfg.pageId,
      componentId,
      title,
      description: message,
      notifySubscribers: Boolean(cfg.notifySubscribers),
    })
    siteState = { ok: false, changeId }
    console.log(`[status][${site.statusName}] 已开故障 change_id=${changeId} — ${message}`)
    return siteState
  }

  if (ok && !siteState.ok && siteState.changeId) {
    await resolveIncident({
      apiBase: cfg.apiBase,
      statusKey: cfg.statusKey,
      pageId: cfg.pageId,
      changeId: siteState.changeId,
      componentId,
      description: message,
    })
    siteState = { ok: true, changeId: null }
    console.log(`[status][${site.statusName}] 已恢复 — ${message}`)
    return siteState
  }

  if (!ok && !siteState.ok) {
    console.log(`[status][${site.statusName}] 故障持续 — ${message}`)
  } else {
    console.log(`[status][${site.statusName}] 正常`)
  }
  return { ...siteState, ok }
}

const sites = resolveSites(config)
/** @type {Record<string, string>} */
const componentIds = {}
for (const site of sites) {
  componentIds[site.statusName] = await resolveComponentId(
    config.apiBase,
    config.statusKey,
    config.pageId,
    site.statusName,
  )
  console.log(
    `[boot] page=${config.pageId} component=${site.statusName} id=${componentIds[site.statusName]}`,
  )
}

let state = loadState()
const tick = async () => {
  try {
    for (const site of sites) {
      const prev = state.sites[site.statusName] || { ok: true, changeId: null }
      state.sites[site.statusName] = await runOnce(
        config,
        site,
        componentIds[site.statusName],
        prev,
      )
    }
    saveState(state)
  } catch (error) {
    console.error(`[error] ${error instanceof Error ? error.message : String(error)}`)
  }
}

await tick()
if (process.argv.includes('--once')) process.exit(0)
setInterval(tick, config.intervalMs || 120_000)
