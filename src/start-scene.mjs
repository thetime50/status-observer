import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveDir } from './load-config.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const scene = resolveDir(process.argv[2])
run(path.join(here, 'start-local.mjs'), path.join(scene, 'local'))
run(path.join(here, 'start-intl.mjs'), path.join(scene, 'intl'))

function run(script, dir) {
  const result = spawnSync(process.execPath, [script, dir], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status || 1)
}
