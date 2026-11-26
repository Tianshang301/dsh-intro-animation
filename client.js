/*!
 * dsh-intro-animation — Client half
 *
 * 在 Web / 桌面端页面启动时，以全屏浮层播放开场动画：
 *   黑底白线逐笔勾勒 → 金光扩散 → 晕染上色 → 凤凰/烟花 → AGI 文案 → 落款收尾。
 *
 * 纯 DOM 实现，不依赖 React 或任何 UI slot；动画以 iframe 加载 host 半提供的
 * 同源资源，播放结束或用户点击「跳过动画」后自动淡出移除。
 */
(() => {
  const ID = 'dsh-intro-animation'
  const CONFIG_ROUTE = '/dsh-intro/config'
  const ANIMATION_ROUTE = '/dsh-intro/asset/intro.html'
  const SESSION_KEY = ID + ':played'

  window.__ModuleLoader__.load({
    id: ID,
    factory(require) {
      const DEFAULTS = {
        enabled: true,
        playMode: 'once',
        autoCloseMs: 13600,
        skipLabel: '跳过动画',
        overlayOpacity: 1,
      }

      let config = { ...DEFAULTS }
      let disposed = false
      let overlay = null
      let iframe = null
      let skipButton = null
      let pollTimer = null
      let closeTimer = null
      let fallbackTimer = null
      let messageHandler = null
      let closing = false

      function readSessionFlag() {
        try {
          return window.sessionStorage.getItem(SESSION_KEY) === '1'
        } catch (error) {
          return false
        }
      }

      function writeSessionFlag() {
        try {
          window.sessionStorage.setItem(SESSION_KEY, '1')
        } catch (error) {
          // 隐私模式下 sessionStorage 不可用，退化为每次播放
        }
      }

      function shouldPlay() {
        if (!config.enabled) return false
        if (config.playMode === 'never') return false
        if (config.playMode === 'once' && readSessionFlag()) return false
        return true
      }

      function cleanupDom() {
        if (pollTimer) clearInterval(pollTimer)
        if (closeTimer) clearTimeout(closeTimer)
        if (fallbackTimer) clearTimeout(fallbackTimer)
        pollTimer = closeTimer = fallbackTimer = null
        if (messageHandler) {
          try { window.removeEventListener('message', messageHandler) } catch (error) { /* 忽略 */ }
          messageHandler = null
        }
        if (skipButton && skipButton.parentNode) skipButton.parentNode.removeChild(skipButton)
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay)
        skipButton = overlay = iframe = null
        closing = false
      }

      function fadeOut(delay) {
        if (closing || !overlay) return
        closing = true
        if (pollTimer) clearInterval(pollTimer)
        if (fallbackTimer) clearTimeout(fallbackTimer)
        pollTimer = fallbackTimer = null
        const fadeMs = 900
        // 触发 CSS 过渡：先降到 0，过渡结束后再移除节点
        overlay.style.willChange = 'opacity'
        overlay.style.opacity = '0'
        if (skipButton) skipButton.style.opacity = '0'
        closeTimer = setTimeout(() => {
          cleanupDom()
        }, Math.max(delay || 0, fadeMs + 60))
      }

      function watchEnding() {
        // 优先用动画主动发来的结束消息，避免高频轮询 iframe DOM
        messageHandler = (event) => {
          if (!iframe || event.source !== iframe.contentWindow) return
          const data = event.data
          if (data && data.type === 'dsh-intro-ended') fadeOut(1700)
        }
        try {
          window.addEventListener('message', messageHandler)
        } catch (error) {
          // 环境不支持 message 事件时仅依赖轮询与超时兜底
        }
        // 低频轮询作为兜底：消息丢失或跨源不可读时仍能按时收尾
        pollTimer = setInterval(() => {
          try {
            const doc = iframe && iframe.contentDocument
            if (doc && doc.querySelector('.ending.on')) {
              // 落款出现后留一点时间让人看清，再淡出
              fadeOut(1700)
            }
          } catch (error) {
            // iframe 尚未就绪或跨源限制，沿用超时兜底
          }
        }, 500)
      }

      function buildOverlay() {
        overlay = document.createElement('div')
        overlay.setAttribute('data-dsh-intro', '')
        Object.assign(overlay.style, {
          position: 'fixed',
          inset: '0',
          zIndex: '2147483000',
          background: '#05060a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: String(config.overlayOpacity == null ? 1 : config.overlayOpacity),
          transition: 'opacity 900ms cubic-bezier(.22,.61,.36,1)',
        })

        iframe = document.createElement('iframe')
        iframe.setAttribute('title', 'DeepSeek Harness 开场动画')
        iframe.setAttribute('allow', 'autoplay')
        Object.assign(iframe.style, {
          width: '100%',
          height: '100%',
          border: '0',
          display: 'block',
          background: '#05060a',
        })
        iframe.src = ANIMATION_ROUTE
        overlay.appendChild(iframe)

        skipButton = document.createElement('button')
        skipButton.type = 'button'
        skipButton.textContent = config.skipLabel || DEFAULTS.skipLabel
        skipButton.setAttribute('aria-label', '跳过开场动画')
        Object.assign(skipButton.style, {
          position: 'fixed',
          right: '22px',
          bottom: '20px',
          zIndex: '2147483001',
          padding: '8px 16px',
          font: '400 12px Inter, -apple-system, "Segoe UI", sans-serif',
          letterSpacing: '0.08em',
          color: 'rgba(255,255,255,.82)',
          background: 'rgba(10,14,28,.72)',
          border: '1px solid rgba(180,210,255,.28)',
          borderRadius: '20px',
          cursor: 'pointer',
        })
        skipButton.style.transition = 'opacity 600ms ease'
        skipButton.addEventListener('click', () => fadeOut(120))
        overlay.appendChild(skipButton)

        ;(document.body || document.documentElement).appendChild(overlay)
        watchEnding()
        fallbackTimer = setTimeout(() => fadeOut(1700), Number(config.autoCloseMs) || DEFAULTS.autoCloseMs)
      }

      function start(force) {
        if (disposed) return
        cleanupDom()
        // 自动播放遵守 once/never；手动重播（force）显式绕过这两项限制
        if (!force && !shouldPlay()) return
        writeSessionFlag()
        buildOverlay()
      }

      function onDomReady(fn) {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', fn, { once: true })
        } else {
          fn()
        }
      }

      function apply(ctx) {
        fetch(CONFIG_ROUTE, { cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : null))
          .then((data) => {
            if (data && typeof data === 'object') config = { ...DEFAULTS, ...data }
          })
          .catch(() => {})
          .finally(() => onDomReady(start))

        // 暴露手动重播入口，方便在控制台或自定义入口中调用
        try {
          window.dshIntroAnimation = { replay: () => start(true), stop: () => fadeOut(0) }
        } catch (error) {
          // 某些受限环境不允许挂全局对象，忽略
        }

        const dispose = () => {
          disposed = true
          cleanupDom()
          try {
            if (window.dshIntroAnimation) delete window.dshIntroAnimation
          } catch (error) {
            // 忽略
          }
        }
        try {
          ctx.effect(() => dispose, 'dsh-intro-animation: teardown')
        } catch (error) {
          // 老版本 client 上下文没有 effect 时，动画仍可正常播放
        }
      }

      const module = { exports: {} }
      module.exports.apply = apply
      module.exports.inject = []
      return module.exports
    },
  })
})()
