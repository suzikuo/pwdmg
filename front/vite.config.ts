import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const buildTargets = new Set(['android', 'desktop', 'web'])

export default defineConfig(({ mode }) => {
  const target = buildTargets.has(mode) ? mode : 'android'

  return {
    plugins: [vue()],
    base: './',
    build: {
      outDir: `dist/${target}`,
      emptyOutDir: true
    }
  }
})
