import { computed, ref } from 'vue'
import { showFailToast, showSuccessToast } from '../services/uiFeedback'
import { api } from '../services/api'
import type { ApiResult, DesktopCloseBehavior, DesktopTraySettings } from '../types'

const DEFAULT_CLOSE_BEHAVIOR: DesktopCloseBehavior = 'exit'

export function useDesktopTraySettings(desktopSupported: boolean) {
  const state = ref<DesktopTraySettings | null>(null)
  const busy = ref(false)
  const showSettings = computed(() => desktopSupported && state.value?.supported !== false)

  async function load() {
    if (!desktopSupported || busy.value) return
    const current = state.value
    const result = await api.getDesktopTraySettings()
    if (result.ok && result.data && state.value === current && !busy.value) state.value = result.data
  }

  async function save(
    request: () => Promise<ApiResult<DesktopTraySettings>>,
    failureMessage: string
  ): Promise<boolean> {
    if (!desktopSupported || busy.value) return false
    busy.value = true
    try {
      const result = await request()
      if (!result.ok || !result.data) {
        showFailToast(result.message || failureMessage)
        return false
      }
      state.value = result.data
      return true
    } catch {
      showFailToast(failureMessage)
      return false
    } finally {
      busy.value = false
    }
  }

  function update(trayEnabled: boolean, closeBehavior: DesktopCloseBehavior) {
    const current = state.value
    if (current?.trayEnabled === trayEnabled && current.closeBehavior === closeBehavior) return
    return save(() => api.setDesktopTraySettings(trayEnabled, closeBehavior), '无法更新托盘设置')
  }

  function toggle(enabled: boolean) {
    return update(enabled, state.value?.closeBehavior || DEFAULT_CLOSE_BEHAVIOR)
  }

  function setCloseBehavior(closeBehavior: DesktopCloseBehavior) {
    return update(state.value?.trayEnabled ?? true, closeBehavior)
  }

  async function setGpuAcceleration(enabled: boolean) {
    const current = state.value?.gpuAccelerationEnabled
    if (typeof current !== 'boolean' || current === enabled) return
    if (await save(() => api.setDesktopGpuAcceleration(enabled), '无法更新 GPU 硬件加速设置')) {
      showSuccessToast('GPU 硬件加速设置已保存，完全退出并重新打开应用后生效')
    }
  }

  return { state, busy, showSettings, load, toggle, setCloseBehavior, setGpuAcceleration }
}
