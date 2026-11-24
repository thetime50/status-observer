/**
 * Uptime Kuma 本机管理：export / import / deploy
 * - export <file.json>：data/kuma.db → 指定 JSON（去掉忽略字段）
 * - import <file.json>：指定 JSON → data/kuma.db（需已完成首次管理员创建）
 * - deploy：docker compose up -d（data 由容器首次启动生成）
 *
 * Demo（在 tools/uptime-kuma 目录下）：
 *   node kuma.mjs deploy
 *   node kuma.mjs import ./monitors.json
 *   node kuma.mjs export ./monitors.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DB = path.join(__dirname, 'data', 'kuma.db')

/** 导出时丢弃的 monitor 列（用不到的协议/内部字段）；真正在用的字段不要放这里 */
const IGNORE_MONITOR_FIELDS = new Set([
  'id',
  'user_id',
  'created_date',
  'weight',
  'hostname',
  'port',
  'dns_resolve_type',
  'dns_resolve_server',
  'dns_last_result',
  'push_token',
  'docker_host',
  'docker_container',
  'proxy_id',
  'mqtt_topic',
  'mqtt_success_message',
  'mqtt_username',
  'mqtt_password',
  'database_connection_string',
  'database_query',
  'auth_method',
  'auth_domain',
  'auth_workstation',
  'basic_auth_user',
  'basic_auth_pass',
  'grpc_url',
  'grpc_protobuf',
  'grpc_body',
  'grpc_metadata',
  'grpc_method',
  'grpc_service_name',
  'grpc_enable_tls',
  'radius_username',
  'radius_password',
  'radius_calling_station_id',
  'radius_called_station_id',
  'radius_secret',
  'resend_interval',
  'packet_size',
  'game',
  'gamedig_given_port_only',
  'http_body_encoding',
  'tls_ca',
  'tls_cert',
  'tls_key',
  'parent',
  'kafka_producer_topic',
  'kafka_producer_brokers',
  'kafka_producer_sasl_options',
  'kafka_producer_message',
  'kafka_producer_ssl',
  'kafka_producer_allow_auto_topic_creation',
  'oauth_client_id',
  'oauth_client_secret',
  'oauth_token_url',
  'oauth_scopes',
  'oauth_auth_method',
])

function usage() {
  console.log(`用法:
  node kuma.mjs deploy
  node kuma.mjs import <file.json>
  node kuma.mjs export <file.json>

Demo:
  node kuma.mjs deploy
  node kuma.mjs import ./monitors.json
  node kuma.mjs export ./backup-monitors.json`)
}

function resolveJsonPath(fileArg) {
  if (!fileArg) throw new Error('请指定 JSON 文件路径，例如: node kuma.mjs export ./monitors.json')
  return path.isAbsolute(fileArg) ? fileArg : path.resolve(process.cwd(), fileArg)
}

function stopKuma() {
  try {
    execFileSync('docker', ['compose', 'stop'], { cwd: __dirname, stdio: 'inherit' })
  } catch {
    /* 可能尚未创建 */
  }
}

function requireDataDb() {
  if (!fs.existsSync(DATA_DB)) {
    throw new Error(`缺少 ${DATA_DB}。请先 node kuma.mjs deploy，打开页面创建管理员后再 import/export`)
  }
}

function openDb(file) {
  if (!fs.existsSync(file)) throw new Error(`数据库不存在: ${file}`)
  return new DatabaseSync(file)
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name)
}

function stripMonitor(row) {
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [k, v] of Object.entries(row)) {
    if (IGNORE_MONITOR_FIELDS.has(k)) continue
    if (v === null || v === undefined) continue
    out[k] = v
  }
  return out
}

function cmdExport(jsonPath) {
  requireDataDb()
  stopKuma()
  const db = openDb(DATA_DB)
  const rows = db.prepare('SELECT * FROM monitor ORDER BY id').all()
  db.close()

  let admin = { username: 'admin', password: 'cloud-dsh-kuma' }
  if (fs.existsSync(jsonPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
      if (prev.admin) admin = prev.admin
    } catch {
      /* keep default */
    }
  }

  const payload = {
    exportedAt: new Date().toISOString().slice(0, 10),
    note: '由 node kuma.mjs export 生成；字段名与 kuma.db monitor 表一致（已去掉忽略名单）。',
    admin,
    monitors: rows.map(stripMonitor),
  }
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true })
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(`已导出 ${payload.monitors.length} 条监控 → ${jsonPath}`)
}

function cmdImport(jsonPath) {
  if (!fs.existsSync(jsonPath)) throw new Error(`缺少 ${jsonPath}`)
  const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  const monitors = payload.monitors
  if (!Array.isArray(monitors) || monitors.length === 0) {
    throw new Error(`${jsonPath} 中 monitors 为空`)
  }

  requireDataDb()
  stopKuma()
  const db = openDb(DATA_DB)
  const cols = tableColumns(db, 'monitor').filter((c) => c !== 'id')
  const user = db.prepare('SELECT id FROM user ORDER BY id LIMIT 1').get()
  if (!user) {
    db.close()
    throw new Error('数据库中无用户：请先打开 http://127.0.0.1:3002/ 创建管理员，再执行 import')
  }

  db.exec('BEGIN')
  try {
    db.exec('DELETE FROM monitor')
    for (const m of monitors) {
      /** @type {Record<string, unknown>} */
      const row = { active: 1, user_id: user.id }
      for (const [k, v] of Object.entries(m)) {
        if (IGNORE_MONITOR_FIELDS.has(k)) continue
        if (!cols.includes(k)) continue
        row[k] = v
      }
      row.user_id = user.id
      const keys = cols.filter((c) => c in row)
      const placeholders = keys.map(() => '?').join(',')
      const sql = `INSERT INTO monitor (${keys.join(',')}) VALUES (${placeholders})`
      db.prepare(sql).run(...keys.map((k) => row[k]))
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    db.close()
    throw e
  }
  db.close()
  console.log(`已导入 ${monitors.length} 条监控 ← ${jsonPath}`)
}

function cmdDeploy() {
  const dir = path.dirname(DATA_DB)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  execFileSync('docker', ['compose', 'up', '-d'], { cwd: __dirname, stdio: 'inherit' })
  console.log('打开 http://127.0.0.1:3002/ ；首次需创建管理员，然后: node kuma.mjs import ./monitors.json')
}

const cmd = process.argv[2]
const fileArg = process.argv[3]
try {
  if (cmd === 'export') cmdExport(resolveJsonPath(fileArg))
  else if (cmd === 'import') cmdImport(resolveJsonPath(fileArg))
  else if (cmd === 'deploy') cmdDeploy()
  else {
    usage()
    process.exit(cmd ? 1 : 0)
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
}
