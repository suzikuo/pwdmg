import { computed, ref } from 'vue'
import { showFailToast, showToast } from 'vant'
import { api } from '../services/api'
import type { AndroidAutofillState } from '../types'

export function useAndroidAutofillSettings() {
  const state = ref<AndroidAutofillState | null>(null)
  const busy = ref(false)
  const showSettings = computed(() => state.value?.supported === true)
  const status = computed(() => {
    const current = state.value
    if (!current) return '未检测'
    if (!current.supported) return '不支持'
    return current.enabled ? '已开启' : '去设置'
  })

  async function load() {
    const result = await api.getAndroidAutofillState()
    if (result.ok && result.data) state.value = result.data
  }

  async function openSettings() {
    if (busy.value) return
    busy.value = true
    try {
      const result = await api.openAndroidAutofillSettings()
      if (!result.ok || !result.data) {
        showFailToast(result.message || '无法打开自动填充设置')
        return
      }
      state.value = result.data
      showToast('请在系统页面选择 My Password')
      window.setTimeout(load, 1000)
    } catch {
      showFailToast('无法打开自动填充设置')
    } finally {
      busy.value = false
    }
  }

  return { state, busy, showSettings, status, load, openSettings }
}
