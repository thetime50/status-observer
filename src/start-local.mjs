import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { compose, dbHasUser, replaceMonitors, sceneComposeEnv } from '../uptime-kuma/kuma.mjs'
import { toKumaRow } from '../shared/expand.mjs'
import { loadConfig, resolveDir, sceneNameFrom } from './load-config.mjs'

const dir = resolveDir(process.argv[2])
const config = await loadConfig(dir)
const scene = sceneNameFrom(dir, config)
const port = config.endpoint.port
if (!port) throw new Error('本机 endpoint 需要 port')
const interval = config.endpoint.interval || 120
const dataDir = path.join(dir, 'data')
const dbFile = path.join(dataDir, 'kuma.db')
const env = sceneComposeEnv({ dataDir, port, project: scene })

fs.mkdirSync(dataDir, { recursive: true })
const created = fs.existsSync(dbFile)

if (!created) {
  await assertPortFree(port)
  compose(['up', '-d'], env)
  console.log(`已创建 ${scene}。打开 http://127.0.0.1:${port}/ 创建管理员后再跑一次`)
  process.exit(0)
}

compose(['up', '-d'], env)
if (!dbHasUser(dbFile)) {
  console.log(`打开 http://127.0.0.1:${port}/ 创建管理员后再跑一次`)
  process.exit(0)
}

if (config.monitors.length === 0) {
  console.log(`${scene} 没有监控项，本机实例已在运行`)
  process.exit(0)
}

const rows = config.monitors.map((item) => toKumaRow(item, interval))
compose(['stop'], env)
replaceMonitors(dbFile, rows)
compose(['up', '-d'], env)
const page = config.endpoint.statusPage ? ` 状态页 ${config.endpoint.statusPage}` : ''
console.log(`已更新 ${scene} ${rows.length} 条监控 → http://127.0.0.1:${port}/${page}`)

function assertPortFree(target) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', () => {
      reject(new Error(`端口 ${target} 已被占用`))
    })
    server.once('listening', () => {
      server.close(() => resolve())
    })
    server.listen(target, '127.0.0.1')
  })
}
