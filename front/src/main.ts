import { createApp } from 'vue'
import Vant from 'vant'
import 'vant/lib/index.css'
import App from './App.vue'
import './styles/app.css'

let appMounted = false

function errorMessage(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error || 'Unknown startup error')
}

function renderStartupError(error: unknown) {
  const root = document.getElementById('app')
  if (!root) return
  const message = errorMessage(error)
  root.innerHTML = `
    <main style="min-height:100vh;display:grid;place-items:center;padding:24px;background:#111827;color:#f8fafc;font:14px/1.6 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;">
      <section style="width:min(560px,100%);border:1px solid rgba(255,255,255,.12);border-radius:8px;background:#1f2937;padding:18px;box-shadow:0 18px 48px rgba(0,0,0,.32);">
        <h1 style="margin:0 0 10px;font-size:18px;">程序启动失败</h1>
        <p style="margin:0 0 12px;color:#cbd5e1;">前端启动时遇到错误，请把下面这段错误发给我。</p>
        <pre style="margin:0;white-space:pre-wrap;word-break:break-word;color:#fca5a5;">${escapeHtml(message)}</pre>
      </section>
    </main>
  `
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

window.addEventListener('error', (event) => {
  if (appMounted) {
    console.error('Unhandled application error:', event.error || event.message)
    return
  }
  renderStartupError(event.error || event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  if (appMounted) {
    console.error('Unhandled application rejection:', event.reason)
    return
  }
  renderStartupError(event.reason)
})

try {
  createApp(App).use(Vant).mount('#app')
  appMounted = true
} catch (error) {
  renderStartupError(error)
  throw error
}
