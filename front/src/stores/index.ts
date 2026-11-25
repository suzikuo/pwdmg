import { inject, provide, watch, type InjectionKey, type Ref } from 'vue'
import { blurActiveElement, noopUiFeedback, type UiFeedback } from '../services/runtime.ts'
import type { useAndroidAutofillSettings } from '../composables/useAndroidAutofillSettings.ts'
import type { useAndroidPasskeyProviderSettings } from '../composables/useAndroidPasskeyProviderSettings.ts'
import type { useDesktopTraySettings } from '../composables/useDesktopTraySettings.ts'
import type { usePluginListenerSettings } from '../composables/usePluginListenerSettings.ts'
import { createUiStore, type UiStore } from './uiStore.ts'
import { createSessionStore, type SessionStore } from './sessionStore.ts'
import { createVaultStore, type VaultStore } from './vaultStore.ts'
import { createSyncStore, type SyncStore } from './syncStore.ts'

export { createUiStore, useUiStore, type UiStore, type OverlayId, type ThemePreference } from './uiStore.ts'
export { createSessionStore, useSessionStore, type SessionStore } from './sessionStore.ts'
export { createVaultStore, useVaultStore, type VaultStore, type SidebarView, type SidebarCounts } from './vaultStore.ts'
export { createSyncStore, useSyncStore, type SyncStore } from './syncStore.ts'

export type AppPlatformSettings = {
  desktopTray: ReturnType<typeof useDesktopTraySettings>
  androidAutofill: ReturnType<typeof useAndroidAutofillSettings>
  androidPasskeyProvider: ReturnType<typeof useAndroidPasskeyProviderSettings>
  pluginListener: ReturnType<typeof usePluginListenerSettings>
}

export type AppStoresOptions = {
  feedback?: UiFeedback
  isPluginBusy?: () => boolean
  pluginDetailOpen?: Ref<boolean>
  resetPluginListenerSettings?: () => void
  platform?: AppPlatformSettings
}

export type AppStores = {
  ui: UiStore
  session: SessionStore
  vault: VaultStore
  sync: SyncStore
  platform?: AppPlatformSettings
  closeTopLayer: () => boolean
}

export const APP_STORES_KEY: InjectionKey<AppStores> = Symbol('mypwdmg.appStores')

export function provideAppStores(stores: AppStores): void {
  provide(APP_STORES_KEY, stores)
}

export function useAppStores(): AppStores {
  const stores = inject(APP_STORES_KEY, null)
  if (!stores) {
    throw new Error('useAppStores() must be called inside a component under provideAppStores()')
  }
  return stores
}

export function createAppStores(options: AppStoresOptions = {}): AppStores {
  const feedback = options.feedback || noopUiFeedback
  const ui = createUiStore()

  const session = createSessionStore({
    ui,
    feedback,
    isPluginBusy: options.isPluginBusy,
    resetPluginListenerSettings: options.resetPluginListenerSettings
  })

  let sync!: SyncStore

  const vault = createVaultStore({
    ui,
    feedback,
    isLocked: () => session.state.locked,
    isUnlocked: () => session.unlocked.value,
    isBusy: () => session.busy.value,
    beginBusyOperation: session.beginBusyOperation,
    finishBusyOperation: session.finishBusyOperation,
    saveVaultForCurrentSession: session.saveVaultForCurrentSession,
    syncSettings: (nextSettings) => sync?.syncSettings(nextSettings),
    scheduleAutoCloudUpload: () => sync?.scheduleAutoCloudUpload(),
    lockVault: session.lockVault,
    safeExit: session.safeExit
  })

  sync = createSyncStore({
    ui,
    feedback,
    getVault: () => vault.vault.value,
    isLocked: () => session.state.locked,
    isPasswordless: () => Boolean(session.state.passwordless),
    applyAdoptedSessionState: session.applyAdoptedSessionState,
    rebindDeviceUnlockAfterPasswordChange: session.rebindDeviceUnlockAfterPasswordChange,
    refreshDeviceUnlockState: session.refreshDeviceUnlockState,
    applyLockedUiState: session.applyLockedUiState,
    publishVaultPayload: vault.publishVaultPayload,
    saveVaultForCurrentSession: session.saveVaultForCurrentSession,
    handleVaultWriteError: vault.handleVaultWriteError,
    collectLocalAttachmentObjects: vault.collectLocalAttachmentObjects,
    reconcileSelectedEntryAfterVaultUpdate: vault.reconcileSelectedEntryAfterVaultUpdate,
    getSessionGeneration: session.vaultSession.current,
    captureSessionGeneration: session.vaultSession.capture,
    isSessionGenerationCurrent: session.vaultSession.isCurrent
  })

  session.bindVaultBridge({
    getVault: () => vault.vault.value,
    publishVaultPayload: vault.publishVaultPayload,
    applyAndroidAutofillSearch: vault.applyAndroidAutofillSearch,
    reconcileSelectedEntryAfterVaultUpdate: vault.reconcileSelectedEntryAfterVaultUpdate,
    resetOnLock: vault.resetOnLock
  })

  session.bindSyncBridge({
    isCloudBusy: () => sync.cloudBusy.value,
    hasPendingCloudSyncReview: sync.hasPendingCloudSyncReview,
    hasCompleteOssSettings: sync.hasCompleteOssSettings,
    beginCloudOperation: sync.beginCloudOperation,
    markCloudOperation: sync.markCloudOperation,
    finishCloudOperation: sync.finishCloudOperation,
    prepareCloudRewriteForPasswordChange: sync.prepareCloudRewriteForPasswordChange,
    rewriteCloudAfterPasswordChange: sync.rewriteCloudAfterPasswordChange,
    setBackupStatus: (message) => { sync.backupStatus.value = message },
    scheduleAutoCloudUpload: sync.scheduleAutoCloudUpload,
    scheduleAutoCloudDownloadCheck: sync.scheduleAutoCloudDownloadCheck,
    clearAllAutoSyncPasswordGates: sync.clearAllAutoSyncPasswordGates,
    resetOnLock: sync.resetOnLock
  })

  // Register unified overlay stack guards & close handlers
  ui.registerOverlayHandler('cloudReview', {
    canClose: () => {
      if (sync.cloudBusy.value) {
        feedback.toast('正在应用同步，请稍候')
        return false
      }
      return true
    },
    onClose: () => sync.hideCloudSyncReview()
  })

  ui.registerOverlayHandler('cloudPasswordPrompt', {
    canClose: () => !sync.cloudPasswordPromptBusy.value,
    onClose: () => sync.cancelCloudPasswordPrompt()
  })

  ui.registerOverlayHandler('portablePassword', {
    canClose: () => !sync.portableBackupBusy.value,
    onClose: () => sync.cancelPortableBackupImport()
  })

  ui.registerOverlayHandler('editor', {
    canClose: () => {
      if (session.busy.value) {
        feedback.toast('正在保存，请稍候')
        return false
      }
      return true
    },
    onClose: () => {
      blurActiveElement()
      vault.closeEditor()
    }
  })

  ui.registerOverlayHandler('passwordChange', {
    canClose: () => {
      if (session.busy.value) {
        feedback.toast('正在保存，请稍候')
        return false
      }
      return true
    }
  })

  ui.registerOverlayHandler('move', {
    onClose: () => {
      vault.moveEntryId.value = ''
      ui.closeOverlay('move')
    }
  })

  if (options.pluginDetailOpen) {
    const pluginDetailOpen = options.pluginDetailOpen
    watch(pluginDetailOpen, (open) => {
      if (open) ui.openOverlay('pluginDetail')
      else ui.closeOverlay('pluginDetail')
    })
    ui.registerOverlayHandler('pluginDetail', {
      onClose: () => {
        pluginDetailOpen.value = false
        ui.closeOverlay('pluginDetail')
      },
      onClear: () => {
        pluginDetailOpen.value = false
      }
    })
  }

  function closeTopLayer(): boolean {
    return ui.closeTopLayer({
      hasActiveSearch: () => Boolean(vault.keyword.value) || vault.entryFilter.value !== 'all',
      clearSearch: () => {
        vault.keyword.value = ''
        vault.entryFilter.value = 'all'
      },
      isDragMode: () => vault.dragMode.value,
      exitDragMode: () => { vault.dragMode.value = false },
      isBatchSelectionMode: () => vault.batchSelectionMode.value,
      exitBatchSelection: vault.exitBatchSelection
    })
  }

  return { ui, session, vault, sync, platform: options.platform, closeTopLayer }
}
