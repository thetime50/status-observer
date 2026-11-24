import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { toFlareEntry } from '../shared/expand.mjs'
import { loadConfig, resolveDir, sceneNameFrom } from './load-config.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..', 'UptimeFlare-Cloud-DSH')
const KEEP_NAMES_REPO = 'UptimeFlare-Cloud-DSH'

const dir = resolveDir(process.argv[2])
const config = await loadConfig(dir)
const scene = sceneNameFrom(dir, config)
const repo = config.endpoint.repo || `UptimeFlare-${scene}`
const branch = config.endpoint.branch || scene
const title = config.endpoint.title || scene

if (!fs.existsSync(path.join(repoRoot, '.git'))) {
  throw new Error(`缺少 UptimeFlare 工作副本 ${repoRoot}`)
}
const dirtyBefore = git(['status', '--porcelain'], { stdio: 'pipe' }).trim()
if (dirtyBefore) throw new Error('UptimeFlare 工作副本有未提交改动，先处理后再发布')

const owner = ghUser()
const remoteUrl = `https://github.com/${owner}/${repo}.git`
const remote = remoteName(remoteUrl, repo)
const hadRemote = remoteExists(remote)
const hadBranch = branchExists(branch)

if (!hadRemote) {
  const token = process.env.CLOUDFLARE_API_TOKEN
  if (!token) throw new Error('没有 CLOUDFLARE_API_TOKEN，已停止，不建仓库')
  createRepo(repo)
  execFileSync('gh', ['secret', 'set', 'CLOUDFLARE_API_TOKEN', '--repo', `${owner}/${repo}`], {
    input: token,
    stdio: ['pipe', 'inherit', 'inherit'],
  })
  git(['remote', 'add', remote, remoteUrl])
}

if (!hadBranch) {
  if (repo === KEEP_NAMES_REPO) git(['checkout', '-b', branch])
  else {
    if (!branchExists('template')) throw new Error('UptimeFlare 工作副本没有 template 分支')
    git(['checkout', '-b', branch, 'template'])
  }
} else {
  git(['checkout', branch])
}

const configPath = path.join(repoRoot, 'uptime.config.ts')
let source = fs.readFileSync(configPath, 'utf8')
source = replaceTitle(source, title)
source = replaceMonitors(source, config.monitors.map(toFlareEntry))
fs.writeFileSync(configPath, source)

if (repo !== KEEP_NAMES_REPO) renameResources(scene)

const dirty = git(['status', '--porcelain'], { stdio: 'pipe' }).toString().trim()
if (dirty) {
  git(['add', 'uptime.config.ts', 'deploy.tf', 'wrangler.toml', 'worker/wrangler.toml', 'deploy/init_d1.py', 'deploy/migrate_kv.py', '.github/workflows/deploy.yml'])
  git(['commit', '-m', 'chore: 更新监控配置'])
  git(['push', '-u', remote, `${branch}:main`])
  console.log(hadRemote && hadBranch ? `已更新 ${owner}/${repo}` : `已创建并发布 ${owner}/${repo}`)
} else {
  console.log(`${owner}/${repo} 配置没有变化`)
}

function ghUser() {
  try {
    return execFileSync('gh', ['api', 'user', '-q', '.login'], { encoding: 'utf8' }).trim()
  } catch {
    const url = git(['remote', 'get-url', 'origin'], { stdio: 'pipe' }).trim()
    const match = url.match(/github\.com[:/]([^/]+)\//)
    if (!match) throw new Error('无法确定 GitHub 账号，请先登录 gh')
    return match[1]
  }
}

function remoteName(url, repoName) {
  const lines = git(['remote', '-v'], { stdio: 'pipe' }).toString().split('\n')
  for (const line of lines) {
    if (line.includes(url) || line.includes(`${repoName}.git`) || line.includes(`${repoName} `)) {
      return line.split(/\s+/)[0]
    }
  }
  return repoName
}

function remoteExists(name) {
  try {
    git(['remote', 'get-url', name], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function branchExists(name) {
  try {
    git(['rev-parse', '--verify', name], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function createRepo(name) {
  try {
    execFileSync(
      'gh',
      ['api', '--method', 'POST', 'user/repos', '-f', `name=${name}`, '-F', 'private=true'],
      { stdio: 'pipe', encoding: 'utf8' },
    )
  } catch (error) {
    const text = `${error.stderr || ''}${error.stdout || ''}`
    if (!text.includes('already exists') && !text.includes('422')) throw error
  }
  console.log(`已建私有仓库 ${name}`)
}

function replaceTitle(source, next) {
  return source.replace(/title:\s*(['"]).*?\1/, `title: ${JSON.stringify(next)}`)
}

function replaceMonitors(source, entries) {
  const keyAt = source.indexOf('monitors:')
  if (keyAt < 0) throw new Error('uptime.config.ts 里没有 monitors')
  const start = source.indexOf('[', keyAt)
  let depth = 0
  for (let i = start; i < source.length; i++) {
    if (source[i] === '[') depth++
    else if (source[i] === ']') {
      depth--
      if (depth === 0) {
        const body = entries.map(flareLiteral).join('\n')
        return `${source.slice(0, start)}[\n${body}\n  ]${source.slice(i + 1)}`
      }
    }
  }
  throw new Error('monitors 数组没有结束')
}

function flareLiteral(entry) {
  const lines = [
    '    {',
    `      id: ${JSON.stringify(entry.id)},`,
    `      name: ${JSON.stringify(entry.name)},`,
    `      method: ${JSON.stringify(entry.method)},`,
    `      target: ${JSON.stringify(entry.target)},`,
  ]
  if (entry.expectedCodes) lines.push(`      expectedCodes: ${JSON.stringify(entry.expectedCodes)},`)
  if (entry.responseKeyword) lines.push(`      responseKeyword: ${JSON.stringify(entry.responseKeyword)},`)
  lines.push(`      timeout: ${entry.timeout},`)
  lines.push(`      headers: { 'User-Agent': 'Uptimeflare' },`)
  lines.push('    },')
  return lines.join('\n')
}

function renameResources(scene) {
  const slug = scene.toLowerCase().replace(/[^a-z0-9]+/g, '_')
  const page = scene.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const files = [
    'deploy.tf',
    '.github/workflows/deploy.yml',
    'wrangler.toml',
    'worker/wrangler.toml',
    'deploy/init_d1.py',
    'deploy/migrate_kv.py',
  ]
  for (const rel of files) {
    const file = path.join(repoRoot, rel)
    if (!fs.existsSync(file)) continue
    let text = fs.readFileSync(file, 'utf8')
    text = text.replaceAll('"uptimeflare_worker"', `"uptimeflare_worker_${slug}"`)
    text = text.replaceAll('"uptimeflare_d1"', `"uptimeflare_d1_${slug}"`)
    text = text.replaceAll('"uptimeflare_kv"', `"uptimeflare_kv_${slug}"`)
    text = text.replaceAll('name = "uptimeflare"', `name = "uptimeflare-${page}"`)
    text = text.replaceAll('--project-name uptimeflare', `--project-name uptimeflare-${page}`)
    fs.writeFileSync(file, text)
  }
}

function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    stdio: opts.stdio || 'inherit',
    encoding: 'utf8',
  })
}
