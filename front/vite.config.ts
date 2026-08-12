import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const buildTargets = new Set(['android', 'desktop', 'web'])

export default defineConfig(({ mode, command }) => {
  const target = buildTargets.has(mode) ? mode : 'android'
  const fileProtocolTarget = target === 'desktop' || target === 'android'
  const plugins = [vue()]
  const packageVersion = process.env.npm_package_version || '0.0.0'
  const configuredStorageMode = process.env.VITE_STORAGE_MODE || process.env.VITE_API_MODE || target

  if (fileProtocolTarget) {
    plugins.push({
      name: 'file-protocol-html',
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
    define: {
      'import.meta.env.PACKAGE_VERSION': JSON.stringify(packageVersion),
      'import.meta.env.MODE': JSON.stringify(target),
      'import.meta.env.DEV': JSON.stringify(command !== 'build'),
      'import.meta.env.PROD': JSON.stringify(command === 'build'),
      'import.meta.env.VITE_STORAGE_MODE': JSON.stringify(configuredStorageMode),
      'import.meta.env.VITE_API_MODE': JSON.stringify('')
    },
    build: {
      outDir: `dist/${target}`,
      emptyOutDir: true,
      target: 'es2018',
      cssTarget: 'chrome61',
      rollupOptions: fileProtocolTarget
        ? {
            output: {
              format: 'iife',
              name: 'MyPasswordManager'
            }
          }
        : undefined
    }
  }
})
