/**
 * dsh-intro-animation — Host half
 *
 * 职责只有两件：
 *   1. 以本机路由提供开场动画的静态资源与运行配置；
 *   2. 安装后把 client 半推送给已打开的页面（首次安装无需整页刷新）。
 *
 * 不注册工具、不读取会话、不访问工作区文件（只读包内 assets）。
 */
import { readFile } from 'node:fs/promises'

export const name = 'dsh-intro-animation'
export const inject = ['clientModules']

const DEFAULT_CONFIG = {
  enabled: true,
  // once = 每个浏览器标签会话只播放一次；always = 每次页面加载都播放；never = 不自动播放
  playMode: 'once',
  autoCloseMs: 13600,
  skipLabel: '跳过动画',
  overlayOpacity: 1,
}

const INTRO_HTML = new URL('./assets/intro.html', import.meta.url)
const USER_CONFIG = new URL('./intro.config.json', import.meta.url)

// 动画资源约 6MB 且只读，首次读取后常驻内存，避免每次请求都走磁盘。
// 仍保持 cache-control: no-store，确保插件更新后浏览器不会命中旧副本。
let assetCache = null

async function loadConfig() {
  let user = {}
  try {
    user = JSON.parse(await readFile(USER_CONFIG, 'utf8'))
  } catch (error) {
    // 没有用户配置文件时静默使用默认值
  }
  return { ...DEFAULT_CONFIG, ...user }
}

function send(response, status, body, type) {
  response.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
  })
  response.end(body)
}

async function handler(request, response) {
  let pathname = '/'
  try {
    pathname = new URL(request.url || '/', 'http://localhost').pathname
  } catch (error) {
    // 畸形 URL 一律 404
  }

  if (request.method !== 'GET') {
    return send(response, 404, 'not found', 'text/plain; charset=utf-8')
  }

  if (pathname === '/dsh-intro/asset/intro.html') {
    try {
      if (!assetCache) assetCache = await readFile(INTRO_HTML)
      return send(response, 200, assetCache, 'text/html; charset=utf-8')
    } catch (error) {
      return send(response, 500, 'intro animation asset is missing', 'text/plain; charset=utf-8')
    }
  }

  if (pathname === '/dsh-intro/config') {
    const config = await loadConfig()
    return send(response, 200, JSON.stringify(config), 'application/json; charset=utf-8')
  }

  return send(response, 404, 'not found', 'text/plain; charset=utf-8')
}

function webService(ctx) {
  try {
    return ctx.get('webServer') ?? ctx.get('httpServer')
  } catch (error) {
    return null
  }
}

export function apply(ctx) {
  // Web 服务键在不同内测版本间有 webServer / httpServer 两种命名，做双键兼容。
  let installed = false
  const install = () => {
    if (installed) return true
    const web = webService(ctx)
    if (!web || typeof web.register !== 'function') return false
    ctx.effect(() => web.register({
      kind: 'prefix',
      path: '/dsh-intro',
      handler,
    }), 'dsh-intro-animation: static routes')
    installed = true
    return true
  }

  if (!install()) {
    const off = ctx.on('internal/service', (name) => {
      if (name === 'webServer' || name === 'httpServer') install()
    })
    ctx.effect(() => () => off(), 'dsh-intro-animation: observe web service')
  }

  // 让当前已打开的页面也能加载 client 半，无需手动刷新。
  const timer = setTimeout(() => {
    try {
      ctx.clientModules.rebuilt('dsh-intro-animation')
    } catch (error) {
      // 页面尚未启动或已关闭，忽略
    }
  }, 1200)
  ctx.effect(() => () => clearTimeout(timer), 'dsh-intro-animation: publish client bundle')
}
