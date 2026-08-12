import { computed, ref } from 'vue'
import { showConfirmDialog, showFailToast, showSuccessToast, showToast } from 'vant'
import { api } from '../services/api'
import type { AndroidPasskeyProviderState } from '../types'

export function useAndroidPasskeyProviderSettings() {
  const state = ref<AndroidPasskeyProviderState | null>(null)
  const busy = ref(false)
  const showSettings = computed(() => state.value?.supported === true)
  const status = computed(() => {
    const current = state.value
    if (!current) return '未检测'
    if (!current.supported) return '不支持'
    if (!current.componentEnabled) return '已关闭'
    return current.systemEnabled ? '已启用' : '待系统授权'
  })

  async function load() {
    const result = await api.getAndroidPasskeyProviderState()
    if (result.ok && result.data) state.value = result.data
  }

  async function openSettings() {
    if (busy.value) return
    busy.value = true
    try {
      const result = await api.openAndroidPasskeyProviderSettings()
      if (!result.ok || !result.data) {
        showFailToast(result.message || '无法打开通行密钥系统设置')
        return
      }
      state.value = result.data
      showToast('请在系统页面选择 My Password')
      window.setTimeout(load, 1000)
    } catch {
      showFailToast('无法打开通行密钥系统设置')
    } finally {
      busy.value = false
    }
  }

  async function toggle(enabled: boolean) {
    if (busy.value) return
    if (!enabled) {
      try {
        await showConfirmDialog({
          title: '关闭通行密钥提供方',
          message: '关闭后，Android 系统将不再向 My Password 请求通行密钥。已保存的通行密钥不会删除。',
          confirmButtonText: '关闭'
        })
      } catch {
        return
      }
    }

    busy.value = true
    try {
      const result = await api.setAndroidPasskeyProviderEnabled(enabled)
      if (!result.ok || !result.data) {
        showFailToast(result.message || (enabled ? '无法开启通行密钥提供方' : '无法关闭通行密钥提供方'))
        return
      }
      state.value = result.data
      if (!enabled) {
        showSuccessToast('通行密钥提供方已关闭')
        return
      }

      showToast('组件已开启，请在系统页面选择 My Password')
      const settingsResult = await api.openAndroidPasskeyProviderSettings()
      if (!settingsResult.ok || !settingsResult.data) {
        showFailToast(settingsResult.message || '无法打开通行密钥系统设置')
        return
      }
      state.value = settingsResult.data
      window.setTimeout(load, 1000)
    } catch {
      showFailToast(enabled ? '无法开启通行密钥提供方' : '无法关闭通行密钥提供方')
    } finally {
      busy.value = false
    }
  }

  return { state, busy, showSettings, status, load, openSettings, toggle }
}
