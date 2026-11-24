import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function resolveDir(arg) {
  if (!arg) throw new Error('请传入目录')
  return path.resolve(arg)
}

export function sceneNameFrom(dir, config) {
  let cur = path.resolve(dir)
  for (let i = 0; i < 8; i++) {
    if (path.basename(cur).endsWith('-sc')) return path.basename(cur)
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  if (config?.scene) return config.scene
  throw new Error('路径上没有 *-sc 目录，请在 config.mjs 里写 scene')
}

export async function loadConfig(dir) {
  const file = path.join(dir, 'config.mjs')
  if (!fs.existsSync(file)) throw new Error(`缺少 ${file}`)
  const mod = await import(pathToFileURL(file).href)
  const config = mod.default
  if (!config?.endpoint || !Array.isArray(config.monitors)) {
    throw new Error(`${file} 需要默认导出 { endpoint, monitors }`)
  }
  return config
}
