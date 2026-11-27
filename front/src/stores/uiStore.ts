import { computed, ref, watch, type WritableComputedRef } from 'vue'
import type { DrawerSection, SystemGroupKey } from '../composables/useSettingsPanel.ts'
import {
  DEFAULT_SKIN_ID,
  WALLPAPER_BLUR_MAX,
  WALLPAPER_BLUR_MIN,
  WALLPAPER_DIM_MAX,
  WALLPAPER_DIM_MIN,
  WALLPAPER_OPACITY_MAX,
  WALLPAPER_OPACITY_MIN,
  applySkinToDocument,
  clearWallpaperImage,
  exportSkinTemplate,
  getSkin,
  installCustomSkin,
  listSkins,
  loadActiveSkinId,
  loadLayoutOverride,
  loadWallpaperImage,
  loadWallpaperSettings,
  prepareWallpaperImageFile,
  resolveEffectiveLayout,
  sanitizeWallpaperSettings,
  saveActiveSkinId,
  saveLayoutOverride,
  saveWallpaperImage,
  saveWallpaperSettings,
  uninstallCustomSkin,
  type SkinDensity,
  type SkinLayoutConfig,
  type SkinLayoutMode,
  type SkinLayoutOverride,
  type SkinListStyle,
  type SkinPlugin,
  type SkinValidationResult,
  type WallpaperSettings
} from '../services/skins/index.ts'
import type { UiContextMenuItem } from '../components/ui/UiContextMenu.vue'
import {
  UI_SCALE_MAX_PERCENT,
  UI_SCALE_MIN_PERCENT,
  loadUiScalePercent
} from '../services/uiScale.ts'
import {
  androidBridgeCall,
  readLocalStorage,
  writeLocalStorage
} from '../services/runtime.ts'

export type ThemeMode = 'light' | 'dark'
export type ThemePreference = ThemeMode | 'system'
export type MobileLayoutMode = 'classic' | 'bottom-tabs' | 'floating-dock'
export type MobileListStyle = 'rows' | 'cards' | 'compact'
export type CssVars = Record<string, string>

export interface AppContextMenuState {
  x: number
  y: number
  header?: string
  items: UiContextMenuItem[]
  onSelect?: (item: UiContextMenuItem) => void
}

export type OverlayId =
  | 'detail'
  | 'editor'
  | 'move'
  | 'batchMove'
  | 'generator'
  | 'import'
  | 'passkey'
  | 'health'
  | 'quickAccess'
  | 'settings'
  | 'mobileNav'
  | 'cloudReview'
  | 'cloudPasswordPrompt'
  | 'portablePassword'
  | 'passwordChange'
  | 'deviceUnlock'
  | 'pluginDetail'
  | 'contextMenu'

export type OverlayHandler = {
  /**
   * Optional guard invoked before closing this overlay from Esc / Android Back.
   * Returning false blocks closing while still signaling that the layer handled the key.
   */
  canClose?: () => boolean
  /**
   * Optional custom close handler invoked by closeTopLayer().
   * If omitted, closeOverlay(id) is called automatically.
   */
  onClose?: () => void
  /**
   * Optional cleanup invoked when clearAllOverlays() resets every layer (e.g. on lock).
   */
  onClear?: () => void
}

export type CloseTopLayerFallbacks = {
  hasActiveSearch?: () => boolean
  clearSearch?: () => void
  isDragMode?: () => boolean
  exitDragMode?: () => void
  isBatchSelectionMode?: () => boolean
  exitBatchSelection?: () => void
}

export const DESKTOP_QUERY = '(min-width: 768px)'
export const DRAWER_WIDE_QUERY = '(min-width: 680px)'
export const SIDEBAR_COLLAPSED_KEY = 'mypwdmg.sidebarCollapsed'
export const PANE_WIDTH_KEY = 'mypwdmg.desktopPaneWidth'
export const PANE_WIDTH_MIN = 280
export const PANE_WIDTH_MAX = 540
export const PANE_WIDTH_KEYBOARD_STEP = 20
export const UI_SCALE_KEY = 'mypwdmg.uiScalePercent.v3'
export const LEGACY_UI_SCALE_KEY = 'mypwdmg.uiScaleLevel.v2'
export const FONT_SIZE_KEY = 'mypwdmg.fontSizePercent'
export const FONT_SIZE_MIN = 80
export const FONT_SIZE_MAX = 130
export const THEME_KEY = 'mypwdmg.theme'
export const MOBILE_LAYOUT_MODE_KEY = 'mypwdmg.mobileLayoutMode.v1'
export const MOBILE_LIST_STYLE_KEY = 'mypwdmg.mobileListStyle.v1'

export function normalizeMobileLayoutMode(value: unknown): MobileLayoutMode {
  if (value === 'bottom-tabs' || value === 'floating-dock') return value
  return 'classic'
}

export function normalizeMobileListStyle(value: unknown): MobileListStyle {
  if (value === 'cards' || value === 'compact') return value
  return 'rows'
}

function loadMobileLayoutMode(): MobileLayoutMode {
  return normalizeMobileLayoutMode(readLocalStorage(MOBILE_LAYOUT_MODE_KEY))
}

function loadMobileListStyle(): MobileListStyle {
  return normalizeMobileListStyle(readLocalStorage(MOBILE_LIST_STYLE_KEY))
}

function resolveSystemTheme(): ThemeMode {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

function loadInitialThemePreference(): ThemePreference {
  const stored = readLocalStorage(THEME_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return resolveSystemTheme()
}

function clampSliderValue(value: number | number[], min: number, max: number): number {
  const raw = Array.isArray(value) ? value[0] : value
  const next = Number(raw)
  if (!Number.isFinite(next)) return min
  return Math.min(Math.max(Math.round(next), min), max)
}

function loadUiScale(): number {
  return loadUiScalePercent(
    readLocalStorage(UI_SCALE_KEY),
    readLocalStorage(LEGACY_UI_SCALE_KEY)
  )
}

function loadFontSize(): number {
  const rawValue = readLocalStorage(FONT_SIZE_KEY)
  if (rawValue === null || rawValue === '') return 100
  const value = Number(rawValue)
  if (!Number.isFinite(value)) return 100
  return clampSliderValue(value, FONT_SIZE_MIN, FONT_SIZE_MAX)
}

function loadPaneWidth(): number {
  const value = Number(readLocalStorage(PANE_WIDTH_KEY))
  return Number.isFinite(value) && value > 0 ? value : 340
}

function loadSidebarCollapsed(): boolean {
  return readLocalStorage(SIDEBAR_COLLAPSED_KEY) === '1'
}

function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`
}

export function createUiStore() {
  // ---- Theme / Skin / Scale / Typography ----
  const themePreference = ref<ThemePreference>(loadInitialThemePreference())
  const systemDark = ref(resolveSystemTheme() === 'dark')
  const theme = computed<ThemeMode>(() =>
    themePreference.value === 'system'
      ? (systemDark.value ? 'dark' : 'light')
      : themePreference.value
  )

  const availableSkins = ref<SkinPlugin[]>(listSkins())
  const activeSkinId = ref<string>(loadActiveSkinId())
  const layoutOverride = ref<SkinLayoutOverride>(loadLayoutOverride())
  const activeSkin = computed<SkinPlugin>(() =>
    availableSkins.value.find((skin) => skin.id === activeSkinId.value)
    || getSkin(DEFAULT_SKIN_ID)
  )
  const activeLayout = computed<SkinLayoutConfig>(() =>
    resolveEffectiveLayout(activeSkin.value, layoutOverride.value)
  )
  const hasLayoutOverride = computed<boolean>(() =>
    Boolean(layoutOverride.value.mode || layoutOverride.value.density || layoutOverride.value.listStyle)
  )

  const mobileLayoutMode = ref<MobileLayoutMode>(loadMobileLayoutMode())
  const mobileListStyle = ref<MobileListStyle>(loadMobileListStyle())
  const hasMobileLayoutOverride = computed<boolean>(() =>
    mobileLayoutMode.value !== 'classic' || mobileListStyle.value !== 'rows' || Boolean(layoutOverride.value.density)
  )

  const uiScalePercent = ref(loadUiScale())
  const fontSizePercent = ref(loadFontSize())

  // ---- Custom Wallpaper & Surface Transparency ----
  const wallpaperSettings = ref<WallpaperSettings>(loadWallpaperSettings())
  const wallpaperImageUrl = ref<string>('')
  const wallpaperActive = computed<boolean>(() => Boolean(wallpaperImageUrl.value))

  // ---- Responsive & Desktop Pane Resize ----
  const isWide = ref(false)
  const isDrawerWide = ref(false)
  const paneWidth = ref(loadPaneWidth())
  const workspaceGrid = ref<HTMLElement | null>(null)
  let desktopMediaQuery: MediaQueryList | null = null
  let drawerMediaQuery: MediaQueryList | null = null
  let colorSchemeMediaQuery: MediaQueryList | null = null
  let resizingPane = false

  // ---- Workspace Chrome & Drawer Sub-Navigation ----
  const sidebarCollapsed = ref(loadSidebarCollapsed())
  const searchOpen = ref(false)
  const moreMenuOpen = ref(false)
  const drawerDetailOpen = ref(false)
  const drawerSection = ref<DrawerSection>('appearance')
  const systemGroupKey = ref<SystemGroupKey>('archived')

  function setSidebarCollapsed(collapsed: boolean): void {
    sidebarCollapsed.value = collapsed
    writeLocalStorage(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
  }

  function toggleSidebarCollapsed(): void {
    setSidebarCollapsed(!sidebarCollapsed.value)
  }

  const drawerSectionTitle = computed(() => {
    if (drawerSection.value === 'appearance' || drawerSection.value === 'settings') return '外观与交互'
    if (drawerSection.value === 'security') return '安全与解锁'
    if (drawerSection.value === 'sync' || drawerSection.value === 'backup') return '云同步与备份'
    if (drawerSection.value === 'storage') return '附件与存储'
    if (drawerSection.value === 'system') return '系统分组'
    if (drawerSection.value === 'about' || drawerSection.value === 'updates') return '关于与更新'
    return '设置'
  })

  // ---- Unified Overlay Stack ----
  const overlayStack = ref<OverlayId[]>([])
  const overlayHandlers = new Map<OverlayId, OverlayHandler>()

  const topOverlay = computed<OverlayId | null>(() =>
    overlayStack.value.length > 0 ? overlayStack.value[overlayStack.value.length - 1] : null
  )

  function isOverlayOpen(id: OverlayId): boolean {
    return overlayStack.value.includes(id)
  }

  function openOverlay(id: OverlayId): void {
    const next = overlayStack.value.filter((item) => item !== id)
    next.push(id)
    overlayStack.value = next
  }

  function closeOverlay(id: OverlayId): void {
    if (!overlayStack.value.includes(id)) return
    overlayStack.value = overlayStack.value.filter((item) => item !== id)
    if (id === 'settings') {
      drawerDetailOpen.value = false
    }
  }

  function registerOverlayHandler(id: OverlayId, handler: OverlayHandler): void {
    overlayHandlers.set(id, handler)
  }

  function overlayRef(id: OverlayId): WritableComputedRef<boolean> {
    return computed<boolean>({
      get: () => overlayStack.value.includes(id),
      set: (open: boolean) => {
        if (open) openOverlay(id)
        else closeOverlay(id)
      }
    })
  }

  const detailOpen = overlayRef('detail')
  const editorOpen = overlayRef('editor')
  const moveSheetOpen = overlayRef('move')
  const batchMoveSheetOpen = overlayRef('batchMove')
  const generatorOpen = overlayRef('generator')
  const importOpen = overlayRef('import')
  const passkeyManagerOpen = overlayRef('passkey')
  const passwordHealthOpen = overlayRef('health')
  const quickAccessOpen = overlayRef('quickAccess')
  const drawerOpen = overlayRef('settings')
  const mobileNavOpen = overlayRef('mobileNav')
  const cloudSyncReviewOpen = overlayRef('cloudReview')
  const cloudPasswordPromptOpen = overlayRef('cloudPasswordPrompt')
  const portableBackupPasswordOpen = overlayRef('portablePassword')
  const passwordSheetOpen = overlayRef('passwordChange')
  const deviceUnlockSheetOpen = overlayRef('deviceUnlock')
  const pluginDetailOpen = overlayRef('pluginDetail')
  const entryContextMenuOpen = overlayRef('contextMenu')
  const contextMenuState = ref<AppContextMenuState>({
    x: 0,
    y: 0,
    header: '',
    items: []
  })

  function openContextMenu(state: AppContextMenuState): void {
    if (!state.items.length) {
      closeContextMenu()
      return
    }
    moreMenuOpen.value = false
    contextMenuState.value = state
    openOverlay('contextMenu')
  }

  function closeContextMenu(): void {
    closeOverlay('contextMenu')
    contextMenuState.value = { x: 0, y: 0, header: '', items: [] }
  }

  function handleContextMenuSelect(item: UiContextMenuItem): void {
    const handler = contextMenuState.value.onSelect
    closeContextMenu()
    handler?.(item)
  }

  registerOverlayHandler('contextMenu', {
    onClose: () => closeContextMenu(),
    onClear: () => {
      contextMenuState.value = { x: 0, y: 0, header: '', items: [] }
    }
  })

  function closeTopLayer(fallbacks: CloseTopLayerFallbacks = {}): boolean {
    const top = topOverlay.value
    if (top) {
      const handler = overlayHandlers.get(top)
      if (handler?.canClose && !handler.canClose()) {
        return true
      }
      if (top === 'settings' && drawerDetailOpen.value && !isDrawerWide.value) {
        drawerDetailOpen.value = false
        return true
      }
      if (handler?.onClose) {
        handler.onClose()
      } else {
        closeOverlay(top)
      }
      return true
    }

    if (moreMenuOpen.value) {
      moreMenuOpen.value = false
      return true
    }
    if (searchOpen.value || fallbacks.hasActiveSearch?.()) {
      searchOpen.value = false
      fallbacks.clearSearch?.()
      return true
    }
    if (fallbacks.isDragMode?.()) {
      fallbacks.exitDragMode?.()
      return true
    }
    if (fallbacks.isBatchSelectionMode?.()) {
      fallbacks.exitBatchSelection?.()
      return true
    }
    return false
  }

  function clearAllOverlays(): void {
    const active = [...overlayStack.value]
    overlayStack.value = []
    drawerDetailOpen.value = false
    searchOpen.value = false
    moreMenuOpen.value = false
    for (const id of active) {
      overlayHandlers.get(id)?.onClear?.()
    }
  }

  // ---- Theme, Skin & Scale Application ----
  function syncAndroidSystemBarsTheme(): void {
    void androidBridgeCall('setSystemBarsTheme', theme.value)
  }

  function applySkin(): void {
    applySkinToDocument(activeSkin.value, theme.value, activeLayout.value, {
      active: wallpaperActive.value,
      surfaceOpacity: wallpaperSettings.value.surfaceOpacity,
      wallpaperBlur: wallpaperSettings.value.wallpaperBlur,
      wallpaperDim: wallpaperSettings.value.wallpaperDim
    })
  }

  function updateWallpaperSettings(partial: Partial<WallpaperSettings>, save = true): void {
    const next = sanitizeWallpaperSettings({
      ...wallpaperSettings.value,
      ...partial
    })
    wallpaperSettings.value = next
    if (save) {
      saveWallpaperSettings(next)
    }
    applySkin()
  }

  async function setWallpaperImageFromFile(file: File): Promise<void> {
    const dataUrl = await prepareWallpaperImageFile(file)
    await saveWallpaperImage(dataUrl)
    wallpaperImageUrl.value = dataUrl
    updateWallpaperSettings({ hasImage: true }, true)
  }

  async function clearWallpaper(): Promise<void> {
    await clearWallpaperImage()
    wallpaperImageUrl.value = ''
    updateWallpaperSettings({ hasImage: false }, true)
  }

  async function hydrateWallpaper(): Promise<void> {
    if (!wallpaperSettings.value.hasImage) return
    const dataUrl = await loadWallpaperImage()
    if (dataUrl) {
      wallpaperImageUrl.value = dataUrl
      applySkin()
    } else {
      updateWallpaperSettings({ hasImage: false }, true)
    }
  }

  function applyTheme(): void {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = theme.value
    }
    writeLocalStorage(THEME_KEY, themePreference.value)
    applySkin()
    syncAndroidSystemBarsTheme()
  }

  function setTheme(next: ThemePreference): void {
    themePreference.value = next
    applyTheme()
  }

  function toggleTheme(): void {
    setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  function refreshAvailableSkins(): void {
    availableSkins.value = listSkins()
    if (!availableSkins.value.some((skin) => skin.id === activeSkinId.value)) {
      activeSkinId.value = DEFAULT_SKIN_ID
      saveActiveSkinId(DEFAULT_SKIN_ID)
    }
  }

  function syncSidebarForLayoutMode(mode: SkinLayoutMode): void {
    if (mode === 'compact-cards') {
      setSidebarCollapsed(true)
    } else if (mode === 'three-pane') {
      setSidebarCollapsed(false)
    }
  }

  function setSkin(id: string): void {
    const resolved = getSkin(id)
    const prevMode = activeLayout.value.mode
    activeSkinId.value = resolved.id
    saveActiveSkinId(resolved.id)
    const nextMode = activeLayout.value.mode
    if (nextMode !== prevMode) {
      syncSidebarForLayoutMode(nextMode)
    }
    applySkin()
  }

  function updateLayoutOverride(patch: Partial<SkinLayoutOverride>): void {
    const prevMode = activeLayout.value.mode
    const next: SkinLayoutOverride = { ...layoutOverride.value }
    if ('mode' in patch) {
      if (patch.mode) next.mode = patch.mode
      else delete next.mode
    }
    if ('density' in patch) {
      if (patch.density) next.density = patch.density
      else delete next.density
    }
    if ('listStyle' in patch) {
      if (patch.listStyle) next.listStyle = patch.listStyle
      else delete next.listStyle
    }
    layoutOverride.value = next
    saveLayoutOverride(next)
    const nextMode = activeLayout.value.mode
    if (nextMode !== prevMode) {
      syncSidebarForLayoutMode(nextMode)
    }
    applySkin()
  }

  function setLayoutMode(mode: SkinLayoutMode | null): void {
    updateLayoutOverride({ mode })
  }

  function setListStyle(listStyle: SkinListStyle | null): void {
    updateLayoutOverride({ listStyle })
  }

  function setDensity(density: SkinDensity | null): void {
    updateLayoutOverride({ density })
  }

  function setMobileLayoutMode(mode: MobileLayoutMode): void {
    const next = normalizeMobileLayoutMode(mode)
    mobileLayoutMode.value = next
    writeLocalStorage(MOBILE_LAYOUT_MODE_KEY, next)
  }

  function setMobileListStyle(style: MobileListStyle): void {
    const next = normalizeMobileListStyle(style)
    mobileListStyle.value = next
    writeLocalStorage(MOBILE_LIST_STYLE_KEY, next)
  }

  function resetMobileLayoutOverride(): void {
    setMobileLayoutMode('classic')
    setMobileListStyle('rows')
    if (layoutOverride.value.density) updateLayoutOverride({ density: null })
  }

  function resetLayoutOverride(): void {
    const prevMode = activeLayout.value.mode
    layoutOverride.value = {}
    saveLayoutOverride({})
    const nextMode = activeLayout.value.mode
    if (nextMode !== prevMode) {
      syncSidebarForLayoutMode(nextMode)
    }
    applySkin()
  }

  function installSkinFromJson(jsonText: string): SkinValidationResult {
    const result = installCustomSkin(jsonText)
    if (result.ok) {
      refreshAvailableSkins()
      setSkin(result.skin.id)
    }
    return result
  }

  function removeCustomSkin(id: string): boolean {
    const removed = uninstallCustomSkin(id)
    if (removed) {
      refreshAvailableSkins()
      applySkin()
    }
    return removed
  }

  function exportCurrentSkinJson(): string {
    return exportSkinTemplate(activeSkinId.value, layoutOverride.value)
  }

  watch([activeSkinId, theme, activeLayout, wallpaperActive], () => {
    applySkin()
  })

  function applyTypographyScale(): void {
    if (typeof document === 'undefined') return
    const scale = (uiScalePercent.value / 100) * (fontSizePercent.value / 100)
    const rootStyle = document.documentElement.style
    rootStyle.setProperty('--font-scale', String(fontSizePercent.value / 100))
    rootStyle.setProperty('--app-font-xs', px(11 * scale))
    rootStyle.setProperty('--app-font-sm', px(12 * scale))
    rootStyle.setProperty('--app-font-base', px(14 * scale))
    rootStyle.setProperty('--app-font-md', px(14 * scale))
    rootStyle.setProperty('--app-font-lg', px(16 * scale))
    rootStyle.setProperty('--app-font-xl', px(20 * scale))
    rootStyle.setProperty('--app-font-2xl', px(24 * scale))
  }

  function applyLayoutScale(save = true): void {
    if (save) writeLocalStorage(UI_SCALE_KEY, String(uiScalePercent.value))
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--ui-scale', String(uiScalePercent.value / 100))
    }
    applyTypographyScale()
  }

  function applyFontSize(save = true): void {
    if (save) writeLocalStorage(FONT_SIZE_KEY, String(fontSizePercent.value))
    applyTypographyScale()
  }

  function setUiScaleDraft(value: number | number[]): void {
    uiScalePercent.value = clampSliderValue(value, UI_SCALE_MIN_PERCENT, UI_SCALE_MAX_PERCENT)
    applyLayoutScale(false)
  }

  function commitUiScale(value: number | number[]): void {
    setUiScaleDraft(value)
    applyLayoutScale(true)
  }

  function setFontSizeDraft(value: number | number[]): void {
    fontSizePercent.value = clampSliderValue(value, FONT_SIZE_MIN, FONT_SIZE_MAX)
    applyFontSize(false)
  }

  function commitFontSize(value: number | number[]): void {
    setFontSizeDraft(value)
    applyFontSize(true)
  }

  // ---- Desktop Pane Width & Media Queries ----
  function getPaneWidthMax(): number {
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280
    const available = workspaceGrid.value?.clientWidth || viewportWidth
    return Math.max(PANE_WIDTH_MIN, Math.min(PANE_WIDTH_MAX, available - 340))
  }

  function clampPaneWidth(value: number): number {
    return Math.round(Math.min(Math.max(PANE_WIDTH_MIN, value), getPaneWidthMax()))
  }

  const desktopGridStyle = computed<CssVars>(() => {
    if (!isWide.value) return {} as CssVars
    return { '--vault-pane-width': `${paneWidth.value}px` }
  })
  const paneWidthMax = computed(() => getPaneWidthMax())

  function clampPaneToViewport(): void {
    if (!isWide.value) return
    paneWidth.value = clampPaneWidth(paneWidth.value)
  }

  function syncDesktopMode(): void {
    isWide.value = Boolean(desktopMediaQuery?.matches)
    if (isWide.value) {
      closeOverlay('detail')
      closeOverlay('mobileNav')
    }
    clampPaneToViewport()
  }

  function syncDrawerMode(): void {
    isDrawerWide.value = Boolean(drawerMediaQuery?.matches)
    if (isDrawerWide.value) drawerDetailOpen.value = false
  }

  function syncColorScheme(): void {
    systemDark.value = Boolean(colorSchemeMediaQuery?.matches)
    if (themePreference.value === 'system') applyTheme()
  }

  function startPaneResize(event: PointerEvent): void {
    if (!isWide.value || typeof window === 'undefined' || typeof document === 'undefined') return
    event.preventDefault()
    resizingPane = true
    document.body.classList.add('is-resizing-pane')
    window.addEventListener('pointermove', resizePane)
    window.addEventListener('pointerup', stopPaneResize, { once: true })
  }

  function resizePane(event: PointerEvent): void {
    if (!resizingPane) return
    const rect = workspaceGrid.value?.getBoundingClientRect()
    if (!rect) return
    paneWidth.value = clampPaneWidth(event.clientX - rect.left)
  }

  function resizePaneWithKeyboard(event: KeyboardEvent): void {
    if (!isWide.value) return
    let next = paneWidth.value
    if (event.key === 'ArrowLeft') next -= PANE_WIDTH_KEYBOARD_STEP
    else if (event.key === 'ArrowRight') next += PANE_WIDTH_KEYBOARD_STEP
    else if (event.key === 'Home') next = PANE_WIDTH_MIN
    else if (event.key === 'End') next = getPaneWidthMax()
    else return

    event.preventDefault()
    paneWidth.value = clampPaneWidth(next)
    writeLocalStorage(PANE_WIDTH_KEY, String(paneWidth.value))
  }

  function stopPaneResize(): void {
    if (!resizingPane) return
    resizingPane = false
    writeLocalStorage(PANE_WIDTH_KEY, String(paneWidth.value))
    if (typeof document !== 'undefined') {
      document.body.classList.remove('is-resizing-pane')
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', resizePane)
    }
  }

  function mountUi(): void {
    applyTheme()
    applyLayoutScale(false)
    applyFontSize(false)
    void hydrateWallpaper()
    if (typeof window === 'undefined' || !window.matchMedia) return
    desktopMediaQuery = window.matchMedia(DESKTOP_QUERY)
    drawerMediaQuery = window.matchMedia(DRAWER_WIDE_QUERY)
    colorSchemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    syncDesktopMode()
    syncDrawerMode()
    systemDark.value = colorSchemeMediaQuery.matches
    desktopMediaQuery.addEventListener('change', syncDesktopMode)
    drawerMediaQuery.addEventListener('change', syncDrawerMode)
    colorSchemeMediaQuery.addEventListener('change', syncColorScheme)
    window.addEventListener('resize', clampPaneToViewport)
  }

  function unmountUi(): void {
    desktopMediaQuery?.removeEventListener('change', syncDesktopMode)
    drawerMediaQuery?.removeEventListener('change', syncDrawerMode)
    colorSchemeMediaQuery?.removeEventListener('change', syncColorScheme)
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', clampPaneToViewport)
    }
    stopPaneResize()
  }

  return {
    // Theme, Skin & Scale
    themePreference,
    theme,
    activeSkinId,
    availableSkins,
    activeSkin,
    layoutOverride,
    activeLayout,
    hasLayoutOverride,
    mobileLayoutMode,
    mobileListStyle,
    hasMobileLayoutOverride,
    setSkin,
    setLayoutMode,
    setListStyle,
    setDensity,
    setMobileLayoutMode,
    setMobileListStyle,
    resetMobileLayoutOverride,
    resetLayoutOverride,
    installSkinFromJson,
    removeCustomSkin,
    exportCurrentSkinJson,
    wallpaperSettings,
    wallpaperImageUrl,
    wallpaperActive,
    WALLPAPER_OPACITY_MIN,
    WALLPAPER_OPACITY_MAX,
    WALLPAPER_BLUR_MIN,
    WALLPAPER_BLUR_MAX,
    WALLPAPER_DIM_MIN,
    WALLPAPER_DIM_MAX,
    setWallpaperImageFromFile,
    clearWallpaper,
    updateWallpaperSettings,
    uiScalePercent,
    fontSizePercent,
    UI_SCALE_MIN_PERCENT,
    UI_SCALE_MAX_PERCENT,
    FONT_SIZE_MIN,
    FONT_SIZE_MAX,
    applyTheme,
    setTheme,
    toggleTheme,
    setUiScaleDraft,
    commitUiScale,
    setFontSizeDraft,
    commitFontSize,
    applyLayoutScale,
    applyFontSize,
    // Layout & Pane
    isWide,
    isDrawerWide,
    paneWidth,
    paneWidthMax,
    desktopGridStyle,
    workspaceGrid,
    PANE_WIDTH_MIN,
    PANE_WIDTH_MAX,
    clampPaneToViewport,
    startPaneResize,
    resizePane,
    resizePaneWithKeyboard,
    stopPaneResize,
    // Chrome & Drawer
    sidebarCollapsed,
    setSidebarCollapsed,
    toggleSidebarCollapsed,
    searchOpen,
    moreMenuOpen,
    drawerDetailOpen,
    drawerSection,
    systemGroupKey,
    drawerSectionTitle,
    // Overlay Stack
    overlayStack,
    topOverlay,
    isOverlayOpen,
    openOverlay,
    closeOverlay,
    registerOverlayHandler,
    closeTopLayer,
    clearAllOverlays,
    // Overlay Reactive Bindings
    detailOpen,
    editorOpen,
    moveSheetOpen,
    batchMoveSheetOpen,
    generatorOpen,
    importOpen,
    passkeyManagerOpen,
    passwordHealthOpen,
    quickAccessOpen,
    drawerOpen,
    mobileNavOpen,
    cloudSyncReviewOpen,
    cloudPasswordPromptOpen,
    portableBackupPasswordOpen,
    passwordSheetOpen,
    deviceUnlockSheetOpen,
    pluginDetailOpen,
    entryContextMenuOpen,
    contextMenuState,
    openContextMenu,
    closeContextMenu,
    handleContextMenuSelect,
    // Lifecycle
    mountUi,
    unmountUi
  }
}

export type UiStore = ReturnType<typeof createUiStore>

let defaultUiStore: UiStore | null = null

export function useUiStore(): UiStore {
  if (!defaultUiStore) defaultUiStore = createUiStore()
  return defaultUiStore
}
