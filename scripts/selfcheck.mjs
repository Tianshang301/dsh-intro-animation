/**
 * 离线自检：不启动 DSH，只校验插件包结构、契约与语法。
 * 用法：node scripts/selfcheck.mjs
 */
import { readFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const results = []
let failed = 0

function check(label, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
  if (!ok) failed += 1
}

async function read(relative) {
  return readFile(resolve(root, relative), 'utf8')
}

async function exists(relative) {
  try {
    await access(resolve(root, relative))
    return true
  } catch {
    return false
  }
}

const pkg = JSON.parse(await read('package.json'))
const patch = await read('cordis.patch.yml')
const host = await read('index.js')
const client = await read('client.js')
const html = await read('assets/intro.html')

// manifest 契约
check('package name', pkg.name === 'dsh-intro-animation', pkg.name)
check('ESM type', pkg.type === 'module')
check('host entry', pkg.main === './index.js' && await exists('index.js'))
check('exports["./client"]', Boolean(pkg.exports?.['./client']), String(pkg.exports?.['./client']))
check('dsh.bundle.patch', pkg.dsh?.bundle?.patch === './cordis.patch.yml')
check('dsh.client.platform=web', pkg.dsh?.client?.platform === 'web')
check('assets declared in files', pkg.files?.includes('assets/intro.html'))

// patch 契约
check('patch name matches package', patch.includes(`name: '${pkg.name}'`))
check('patch inserts one row', (patch.match(/- insert:/g) || []).length === 1)

// host 契约
check('host exports name/inject/apply', ['export const name', 'export const inject', 'export function apply'].every((s) => host.includes(s)))
check('host registers /dsh-intro route', host.includes("path: '/dsh-intro'") && host.includes('web.register'))
check('host serves intro asset', host.includes("'/dsh-intro/asset/intro.html'"))
check('host publishes client bundle', host.includes('clientModules.rebuilt'))
check('host webServer/httpServer fallback', host.includes("get('webServer')") && host.includes("get('httpServer')"))

// client 契约
check('client uses ModuleLoader', client.includes('window.__ModuleLoader__.load'))
check('client id matches package', client.includes(`const ID = '${pkg.name}'`) && client.includes('id: ID'))
check('client exports apply/inject', client.includes('module.exports.apply') && client.includes('module.exports.inject'))
check('client loads animation via iframe', client.includes("ANIMATION_ROUTE") && client.includes('createElement(\'iframe\')'))
check('client has skip control', client.includes('skipButton') && client.includes("'跳过动画'"))
check('client has once-mode guard', client.includes('SESSION_KEY') && client.includes("playMode === 'once'"))
check('client has end detection + fallback', client.includes("querySelector('.ending.on')") && client.includes('fallbackTimer'))

// 动画资源
check('animation asset present', html.length > 1_000_000, `${html.length} chars`)
check('animation has line-art stage', html.includes('Into the Unknown'))
check('animation has AGI copy', html.includes('Exploring the essence of AGI'))
check('animation has ending marker', html.includes('class="ending"'))
check('animation has line-reveal mask', html.includes('id="lineReveal"') && html.includes('mask="url(#lineReveal)"'))
check('animation colors shapes per block', (html.match(/class="bs"/g) || []).length >= 10 || html.includes("classList.add('bs')"))

console.log(results.join('\n'))
console.log(`\n${failed === 0 ? 'OK: 插件结构与契约自检全部通过。' : `FAILED: ${failed} 项未通过。`}`)
process.exit(failed === 0 ? 0 : 1)
