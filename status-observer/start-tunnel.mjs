/**
 * 启动 cloudflared 临时隧道，并把拿到的 trycloudflare URL 写回 config.js。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const configPath = path.join(__dirname, 'config.js')
const origin = process.env.CLOUD_DSH_TUNNEL_ORIGIN || 'http://127.0.0.1:8080'
const urlRe = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i

function updateConfig(url) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`缺少 ${configPath}，请先复制 config.example.js`)
  }
  const raw = fs.readFileSync(configPath, 'utf8')
  const next = raw.replace(
    /const\s+tunnelUrl\s*=\s*['"][^'"]*['"]/,
    `const tunnelUrl = '${url}'`,
  )
  if (next === raw) {
    throw new Error('config.js 中未找到 const tunnelUrl = ...')
  }
  fs.writeFileSync(configPath, next, 'utf8')
  console.log(`[tunnel] 已写入 config.js tunnelUrl=${url}`)
}

const child = spawn('cloudflared', ['tunnel', '--url', origin], {
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})

let updated = false
/** @param {Buffer | string} chunk */
function onChunk(chunk) {
  const text = chunk.toString('utf8')
  process.stdout.write(text)
  if (updated) return
  const match = text.match(urlRe)
  if (!match) return
  updated = true
  try {
    updateConfig(match[0])
  } catch (error) {
    console.error(`[tunnel] ${error instanceof Error ? error.message : String(error)}`)
  }
}

child.stdout.on('data', onChunk)
child.stderr.on('data', onChunk)

child.on('error', (error) => {
  console.error(`[tunnel] 启动失败: ${error.message}`)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    console.log(`[tunnel] 被信号结束: ${signal}`)
    process.exit(1)
  }
  process.exit(code ?? 1)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    child.kill('SIGTERM')
  })
}
