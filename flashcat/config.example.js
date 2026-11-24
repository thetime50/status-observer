/**
 * flashcat 配置模板：复制为 config.js 后填写 statusKey 等密钥。
 * sites[] 为多站点探测列表（statusName + testRequests/checks）。
 */
/** @typedef {{ status?: number, text?: string, ms?: number, error?: Error | null }} ProbeCtx */
/** @typedef {{ ok: true } | { ok: false, message: string }} CheckResult */

const tunnelUrl = 'https://updates-xx-xx-xx.trycloudflare.com'

/** @type {Array<(ctx: ProbeCtx) => CheckResult | Promise<CheckResult>>} */
const httpOkChecks = [
  (ctx) => {
    if (ctx.error) return { ok: false, message: `请求失败: ${ctx.error.message}` }
    if (ctx.status !== 200) return { ok: false, message: `HTTP ${ctx.status}` }
    return { ok: true }
  },
]

export default {
  pageId: 7292735200486,
  // Flashduty 控制台「我的 → APP Key」
  statusKey: 'REPLACE_WITH_APP_KEY',
  apiBase: 'https://api.flashcat.cloud',
  intervalMs: 120_000,
  timeoutMs: 10_000,
  notifySubscribers: false,
  sites: [
    {
      // 状态页上的组件名称（启动时按名称解析 component_id）
      statusName: 'cloudflared-tunnel-test',
      testRequests: [
        {
          url: `${tunnelUrl}/manage/api/instances`,
          /**
           * @type {Array<(ctx: ProbeCtx) => CheckResult | Promise<CheckResult>>}
           */
          checks: [
            ...httpOkChecks,
            (ctx) => {
              let data
              try {
                data = JSON.parse(ctx.text || '')
              } catch {
                return { ok: false, message: '响应不是 JSON' }
              }
              if (!Array.isArray(data)) return { ok: false, message: '响应不是数组' }
              return { ok: true }
            },
          ],
        },
      ],
    },
    {
      statusName: 'pst-nav-menu',
      testRequests: [
        {
          url: 'https://xxxx.com/xxx/xxx',
          checks: [
            ...httpOkChecks,
            (ctx) => {
              let data
              try {
                data = JSON.parse(ctx.text || '')
              } catch {
                return { ok: false, message: '响应不是 JSON' }
              }
              if (!data || !Array.isArray(data.menus)) {
                return { ok: false, message: '响应缺少 menus 数组' }
              }
              return { ok: true }
            },
          ],
        },
      ],
    },
  ],
}
