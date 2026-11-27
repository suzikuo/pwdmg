<template>
  <header class="desktop-title-bar" @contextmenu.stop.prevent>
    <div class="desktop-title-bar__drag" data-tauri-drag-region="deep">
      <UiIcon name="lock" :size="14" />
      <span>My Password</span>
    </div>
    <div class="desktop-title-bar__controls" role="group" aria-label="窗口控制">
      <button type="button" title="最小化" aria-label="最小化" @click="runWindowAction('minimize')">
        <span class="caption-minimize" aria-hidden="true" />
      </button>
      <button type="button" :title="maximizeLabel" :aria-label="maximizeLabel" @click="runWindowAction('toggleMaximize')">
        <span class="caption-maximize" :class="{ 'caption-restore': maximized }" aria-hidden="true" />
      </button>
      <button type="button" class="caption-close" title="关闭" aria-label="关闭" @click="runWindowAction('close')">
        <UiIcon name="close" :size="18" :stroke-width="1.5" />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import UiIcon from '../ui/UiIcon.vue'
import { showToast } from '../../services/uiFeedback'

const props = defineProps<{ appWindow: TauriWindow }>()
const maximized = ref(false)
const maximizeLabel = computed(() => maximized.value ? '还原' : '最大化')

let mounted = false
let resizeRequest = 0
let stopTrackingResize: (() => void) | undefined

async function refreshMaximized() {
  const request = ++resizeRequest
  try {
    const value = await props.appWindow.isMaximized()
    if (mounted && request === resizeRequest) maximized.value = value
  } catch (error) {
    console.warn('Could not read window state:', error)
  }
}

async function runWindowAction(action: 'minimize' | 'toggleMaximize' | 'close') {
  try {
    await props.appWindow[action]()
    if (action === 'toggleMaximize' && mounted) await refreshMaximized()
  } catch (error) {
    console.error('Window action failed:', error)
    showToast({ message: '无法操作窗口', type: 'error' })
  }
}

onMounted(async () => {
  mounted = true
  try {
    const unlisten = await props.appWindow.onResized(refreshMaximized)
    if (mounted) stopTrackingResize = unlisten
    else unlisten()
  } catch (error) {
    console.warn('Could not subscribe to window resize:', error)
  }
  if (mounted) await refreshMaximized()
})

onUnmounted(() => {
  mounted = false
  stopTrackingResize?.()
})
</script>

<style scoped>
.desktop-title-bar {
  display: flex;
  align-items: stretch;
  height: var(--desktop-titlebar-height);
  background-color: var(--surface-container-low);
  border-bottom: 1px solid var(--border-soft);
  color: var(--text-main);
  user-select: none;
}

.desktop-title-bar__drag {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding-inline: 12px;
  font-size: var(--app-font-sm);
  font-weight: 600;
}

.desktop-title-bar__controls {
  display: flex;
  flex: none;
}

.desktop-title-bar__controls button {
  display: grid;
  place-items: center;
  width: 46px;
  padding: 0;
  border: 0;
  background-color: transparent;
}

.desktop-title-bar__controls button:hover {
  background-color: var(--surface-container-high);
}

.desktop-title-bar__controls button:active {
  background-color: var(--surface-container-highest);
}

.desktop-title-bar__controls button:focus-visible {
  outline-offset: -3px;
}

.desktop-title-bar__controls .caption-close:hover,
.desktop-title-bar__controls .caption-close:active {
  background-color: var(--danger);
  color: var(--on-danger);
}

.caption-minimize {
  width: 10px;
  border-top: 1px solid currentColor;
}

.caption-maximize {
  width: 10px;
  height: 10px;
  border: 1px solid currentColor;
}

.caption-restore {
  position: relative;
  transform: translate(-1px, 1px);
}

.caption-restore::before {
  position: absolute;
  inset: -3px -3px 1px 1px;
  border-top: 1px solid currentColor;
  border-right: 1px solid currentColor;
  content: '';
}
</style>
