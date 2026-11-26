/**
 * 运行验证：不启动 DSH、不联网。
 *   1. 用假 ctx 捕获 host 注册的 handler，直接跑路由矩阵；
 *   2. 校验配置默认值、用户配置覆盖与非法配置回退；
 *   3. 校验 assets/intro.html 与根目录 motion_intro.html 同步。
 *
 * 用法：node scripts/verify.mjs
 */
import { readFile, writeFile, unlink, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { apply } from '../index.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(root, '..')
const results = []
let failed = 0

function check(label, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
  if (!ok) failed += 1
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

// —— 假 ctx：捕获 host 注册的 handler ——
let captured = null
const disposers = []
const web = {
  register(spec) {
    captured = spec
    return () => {}
  },
}
const ctx = {
  get(name) {
    if (name === 'webServer') return web
    return undefined
  },
  on() {
    return () => {}
  },
  effect(fn) {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
    return dispose
  },
  clientModules: {
    rebuilt() {},
  },
}

apply(ctx)

check(
  'host registers prefix route',
  Boolean(captured) && captured.kind === 'prefix' && captured.path === '/dsh-intro',
  captured ? `${captured.kind} ${captured.path}` : 'none',
)

function call(method, url) {
  return new Promise((resolvePromise) => {
    const res = {
      status: 0,
      headers: {},
      body: null,
      writeHead(status, headers) {
        this.status = status
        this.headers = headers || {}
      },
      end(body) {
        this.body = body
        resolvePromise(this)
      },
    }
    Promise.resolve()
      .then(() => captured.handler({ method, url }, res))
      .catch((error) => {
        res.status = -1
        res.error = error
        resolvePromise(res)
      })
  })
}

const assetPath = resolve(root, 'assets/intro.html')
const assetFile = await readFile(assetPath)

const r1 = await call('GET', '/dsh-intro/asset/intro.html')
check('asset route 200', r1.status === 200, `status=${r1.status}`)
check('asset content-type html', /text\/html/.test(r1.headers['content-type'] || ''), r1.headers['content-type'])
check('asset cache-control no-store', r1.headers['cache-control'] === 'no-store', r1.headers['cache-control'])
check(
  'asset body matches file',
  Boolean(r1.body) && r1.body.length === assetFile.length,
  `${r1.body && r1.body.length} vs ${assetFile.length}`,
)

const r2 = await call('GET', '/dsh-intro/asset/intro.html')
check('asset buffer cached (same reference)', r1.body === r2.body)

const cfg = await call('GET', '/dsh-intro/config')
let parsed = null
try {
  parsed = JSON.parse(cfg.body.toString())
} catch {
  parsed = null
}
check('config route 200', cfg.status === 200, `status=${cfg.status}`)
check('config content-type json', /application\/json/.test(cfg.headers['content-type'] || ''), cfg.headers['content-type'])
check('config defaults enabled', Boolean(parsed) && parsed.enabled === true)
check('config defaults playMode once', Boolean(parsed) && parsed.playMode === 'once')
check('config defaults autoCloseMs', Boolean(parsed) && parsed.autoCloseMs === 13600)
check('config defaults skipLabel', Boolean(parsed) && parsed.skipLabel === '跳过动画')

const post = await call('POST', '/dsh-intro/asset/intro.html')
check('non-GET -> 404', post.status === 404, `status=${post.status}`)

const unknown = await call('GET', '/dsh-intro/nope')
check('unknown path -> 404', unknown.status === 404, `status=${unknown.status}`)

const outside = await call('GET', '/not-dsh-intro')
check('outside prefix -> 404', outside.status === 404, `status=${outside.status}`)

// —— 配置覆盖 / 非法回退（临时文件，自动清理）——
const userCfg = resolve(root, 'intro.config.json')
const hadUserCfg = await exists(userCfg)
if (!hadUserCfg) {
  try {
    await writeFile(userCfg, '{"playMode":"never","autoCloseMs":5000}', 'utf8')
    const over = await call('GET', '/dsh-intro/config')
    let o = null
    try {
      o = JSON.parse(over.body.toString())
    } catch {
      o = null
    }
    check('user config override', Boolean(o) && o.playMode === 'never' && o.autoCloseMs === 5000)
    check('user config keeps defaults', Boolean(o) && o.enabled === true && o.skipLabel === '跳过动画')

    await writeFile(userCfg, '{ not valid json', 'utf8')
    const bad = await call('GET', '/dsh-intro/config')
    let b = null
    try {
      b = JSON.parse(bad.body.toString())
    } catch {
      b = null
    }
    check('invalid config falls back', Boolean(b) && b.playMode === 'once' && b.autoCloseMs === 13600)
  } finally {
    await unlink(userCfg).catch(() => {})
  }
} else {
  results.push('SKIP  config override/fallback — intro.config.json 已存在，未改动')
}

// —— 动画资产同步 ——
const rootHtml = resolve(repoRoot, 'motion_intro.html')
if (await exists(rootHtml)) {
  const rootBuf = await readFile(rootHtml)
  check('motion_intro.html in sync', rootBuf.equals(assetFile), `${rootBuf.length} vs ${assetFile.length}`)
} else {
  results.push('SKIP  motion_intro.html sync — 根目录文件不存在')
}

console.log(results.join('\n'))
console.log(`\n${failed === 0 ? 'OK: 运行验证全部通过。' : `FAILED: ${failed} 项未通过。`}`)
// apply() 内有 1200ms 的发布定时器，验证完成后直接退出
process.exit(failed === 0 ? 0 : 1)
