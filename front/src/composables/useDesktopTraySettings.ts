import { computed, ref } from 'vue'
import { showFailToast } from 'vant'
import { api } from '../services/api'
import type { DesktopCloseBehavior, DesktopTraySettings } from '../types'

const DEFAULT_CLOSE_BEHAVIOR: DesktopCloseBehavior = 'minimize-to-tray'

export function useDesktopTraySettings(desktopSupported: boolean) {
  const state = ref<DesktopTraySettings | null>(null)
  const busy = ref(false)
  const showSettings = computed(() => desktopSupported && state.value?.supported !== false)

  async function load() {
    if (!desktopSupported) return
    const result = await api.getDesktopTraySettings()
    if (result.ok && result.data) state.value = result.data
  }

  async function update(trayEnabled: boolean, closeBehavior: DesktopCloseBehavior) {
    if (!desktopSupported || busy.value) return
    const current = state.value
    if (
      current
      && current.trayEnabled === trayEnabled
      && current.closeBehavior === closeBehavior
    ) return

    busy.value = true
    try {
      const result = await api.setDesktopTraySettings(trayEnabled, closeBehavior)
      if (!result.ok || !result.data) {
        showFailToast(result.message || '无法更新托盘设置')
        return
      }
      state.value = result.data
    } catch {
      showFailToast('无法更新托盘设置')
    } finally {
      busy.value = false
    }
  }

  function toggle(enabled: boolean) {
    return update(enabled, state.value?.closeBehavior || DEFAULT_CLOSE_BEHAVIOR)
  }

  function setCloseBehavior(closeBehavior: DesktopCloseBehavior) {
    return update(state.value?.trayEnabled ?? true, closeBehavior)
  }

  return { state, busy, showSettings, load, toggle, setCloseBehavior }
}
