import { computed, ref } from 'vue'
import { showConfirmDialog, showFailToast, showSuccessToast } from 'vant'
import { api } from '../services/api'
import type { PluginListenerState } from '../types'

export function usePluginListenerSettings(desktopSupported: boolean) {
  const state = ref<PluginListenerState | null>(null)
  const busy = ref(false)
  const extensionId = ref('')
  const detailOpen = ref(false)
  const showSettings = computed(() => desktopSupported && state.value?.supported !== false)
  const status = computed(() => {
    const current = state.value
    if (!current) return '未检测'
    if (!current.supported) return '仅 Windows 支持'
    if (!current.enabled) return '未开启'
    if (current.mode === 'packaged' && !current.hostExecutableExists) return '缺少 Host'
    const browsers = [
      current.chromeRegistered ? 'Chrome' : '',
      current.edgeRegistered ? 'Edge' : ''
    ].filter(Boolean)
    return browsers.length ? `${browsers.join('/')} 已开启` : '未开启'
  })

  async function load() {
    const result = await api.getPluginListenerState()
    if (!result.ok || !result.data) return
    state.value = result.data
    if (!result.data.supported) detailOpen.value = false
    if (!extensionId.value) extensionId.value = result.data.extensionId || ''
  }

  function open() {
    detailOpen.value = true
    void load()
  }

  async function enable() {
    if (busy.value) return
    const normalizedExtensionId = extensionId.value.trim()
    if (!normalizedExtensionId) {
      showFailToast('请先填写插件 ID')
      return
    }

    try {
      await showConfirmDialog({
        title: '开启插件监听',
        message: '将为当前用户注册 Chrome/Edge Native Host。之后浏览器会自动启动后台 Host，不需要手动运行脚本。',
        confirmButtonText: '开启'
      })
    } catch {
      return
    }

    busy.value = true
    try {
      const result = await api.enablePluginListener(normalizedExtensionId, ['chrome', 'edge'])
      if (!result.ok || !result.data) {
        showFailToast(result.message || '开启失败')
        return
      }
      state.value = result.data
      extensionId.value = result.data.extensionId || normalizedExtensionId
      showSuccessToast('插件监听已开启，重载扩展或浏览器后生效')
    } catch {
      showFailToast('开启插件监听失败')
    } finally {
      busy.value = false
    }
  }

  async function disable() {
    if (busy.value) return
    try {
      await showConfirmDialog({
        title: '关闭插件监听',
        message: '将移除当前用户的 Chrome/Edge Native Host 注册。确认关闭吗？',
        confirmButtonText: '关闭',
        confirmButtonColor: '#ee0a24'
      })
    } catch {
      return
    }

    busy.value = true
    try {
      const result = await api.disablePluginListener()
      if (!result.ok || !result.data) {
        showFailToast(result.message || '关闭失败')
        return
      }
      state.value = result.data
      showSuccessToast('插件监听已关闭')
    } catch {
      showFailToast('关闭插件监听失败')
    } finally {
      busy.value = false
    }
  }

  function reset() {
    extensionId.value = ''
    detailOpen.value = false
  }

  return {
    state,
    busy,
    extensionId,
    detailOpen,
    showSettings,
    status,
    load,
    open,
    enable,
    disable,
    reset
  }
}
