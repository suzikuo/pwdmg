import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const buildTargets = new Set(['android', 'desktop', 'web'])

export default defineConfig(({ mode }) => {
  const target = buildTargets.has(mode) ? mode : 'android'
  const plugins = [vue()]

  if (target === 'desktop') {
    plugins.push({
      name: 'desktop-file-protocol-html',
      transformIndexHtml(html) {
        return html
          .replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, '<script defer src="$1"></script>')
          .replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, '<link rel="stylesheet" href="$1">')
      }
    })
  }

  return {
    plugins,
    base: './',
    build: {
      outDir: `dist/${target}`,
      emptyOutDir: true
    }
  }
})
