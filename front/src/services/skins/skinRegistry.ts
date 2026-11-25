import { readLocalStorage, writeLocalStorage } from '../runtime.ts'
import { BUILTIN_SKINS, DEFAULT_SKIN_ID } from './builtinSkins.ts'
import {
  ALLOWED_SKIN_TOKEN_KEYS,
  DEFAULT_SKIN_LAYOUT,
  type SkinDensity,
  type SkinLayoutConfig,
  type SkinLayoutMode,
  type SkinLayoutOverride,
  type SkinListStyle,
  type SkinPlugin,
  type SkinPreviewColors,
  type SkinTokenKey,
  type SkinTokenMap,
  type SkinValidationResult
} from './types.ts'

export { DEFAULT_SKIN_ID }

export const ACTIVE_SKIN_STORAGE_KEY = 'mypwdmg_active_skin'
export const CUSTOM_SKINS_STORAGE_KEY = 'mypwdmg_custom_skins'
export const LAYOUT_OVERRIDE_STORAGE_KEY = 'mypwdmg_skin_layout_override'

const SKIN_ID_RE = /^[a-z0-9][a-z0-9-_]{1,31}$/
const ALLOWED_TOKEN_SET = new Set<string>(ALLOWED_SKIN_TOKEN_KEYS)
const ALLOWED_LAYOUT_MODES = new Set<SkinLayoutMode>(['three-pane', 'top-nav-split', 'compact-cards'])
const ALLOWED_DENSITIES = new Set<SkinDensity>(['compact', 'comfortable', 'airy'])
const ALLOWED_LIST_STYLES = new Set<SkinListStyle>(['rows', 'cards', 'table'])
const BUILTIN_SKIN_IDS = new Set<string>(BUILTIN_SKINS.map((skin) => skin.id))
const FORBIDDEN_CSS_VALUE_RE = /(?:url\s*\(|expression\s*\(|@import|javascript:|data:|\/\*|\*\/|[;{}<>\\]|[\r\n\0])/i
const MAX_TOKEN_VALUE_LENGTH = 300
const MAX_CUSTOM_SKINS = 24

export function resolveSkinLayout(skin: Pick<SkinPlugin, 'layout'> | null | undefined): SkinLayoutConfig {
  return {
    mode: skin?.layout?.mode ?? DEFAULT_SKIN_LAYOUT.mode,
    density: skin?.layout?.density ?? DEFAULT_SKIN_LAYOUT.density,
    listStyle: skin?.layout?.listStyle ?? DEFAULT_SKIN_LAYOUT.listStyle
  }
}

function sanitizeLayoutOverride(raw: unknown): SkinLayoutOverride {
  if (!isPlainRecord(raw)) return {}
  const next: SkinLayoutOverride = {}
  if (typeof raw.mode === 'string' && ALLOWED_LAYOUT_MODES.has(raw.mode as SkinLayoutMode)) {
    next.mode = raw.mode as SkinLayoutMode
  }
  if (typeof raw.density === 'string' && ALLOWED_DENSITIES.has(raw.density as SkinDensity)) {
    next.density = raw.density as SkinDensity
  }
  if (typeof raw.listStyle === 'string' && ALLOWED_LIST_STYLES.has(raw.listStyle as SkinListStyle)) {
    next.listStyle = raw.listStyle as SkinListStyle
  }
  return next
}

export function loadLayoutOverride(): SkinLayoutOverride {
  const raw = readLocalStorage(LAYOUT_OVERRIDE_STORAGE_KEY)
  if (!raw) return {}
  try {
    return sanitizeLayoutOverride(JSON.parse(raw))
  } catch {
    return {}
  }
}

export function saveLayoutOverride(override: SkinLayoutOverride | null | undefined): void {
  const clean = sanitizeLayoutOverride(override)
  writeLocalStorage(LAYOUT_OVERRIDE_STORAGE_KEY, JSON.stringify(clean))
}

export function resolveEffectiveLayout(
  skin: Pick<SkinPlugin, 'layout'> | null | undefined,
  override?: SkinLayoutOverride | null
): SkinLayoutConfig {
  const base = resolveSkinLayout(skin)
  const clean = sanitizeLayoutOverride(override)
  return {
    mode: clean.mode ?? base.mode,
    density: clean.density ?? base.density,
    listStyle: clean.listStyle ?? base.listStyle
  }
}

function validateLayoutConfig(
  raw: unknown
): { ok: true; layout: SkinLayoutConfig } | { ok: false; message: string } {
  if (raw === undefined) {
    return { ok: true, layout: { ...DEFAULT_SKIN_LAYOUT } }
  }
  if (!isPlainRecord(raw)) {
    return { ok: false, message: '皮肤字段 layout 必须是对象' }
  }

  let mode: SkinLayoutMode = DEFAULT_SKIN_LAYOUT.mode
  if (raw.mode !== undefined) {
    if (typeof raw.mode !== 'string' || !ALLOWED_LAYOUT_MODES.has(raw.mode as SkinLayoutMode)) {
      return { ok: false, message: `皮肤 layout.mode 不合法：${String(raw.mode)}` }
    }
    mode = raw.mode as SkinLayoutMode
  }

  let density: SkinDensity = DEFAULT_SKIN_LAYOUT.density
  if (raw.density !== undefined) {
    if (typeof raw.density !== 'string' || !ALLOWED_DENSITIES.has(raw.density as SkinDensity)) {
      return { ok: false, message: `皮肤 layout.density 不合法：${String(raw.density)}` }
    }
    density = raw.density as SkinDensity
  }

  let listStyle: SkinListStyle = DEFAULT_SKIN_LAYOUT.listStyle
  if (raw.listStyle !== undefined) {
    if (typeof raw.listStyle !== 'string' || !ALLOWED_LIST_STYLES.has(raw.listStyle as SkinListStyle)) {
      return { ok: false, message: `皮肤 layout.listStyle 不合法：${String(raw.listStyle)}` }
    }
    listStyle = raw.listStyle as SkinListStyle
  }

  return {
    ok: true,
    layout: { mode, density, listStyle }
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeCssValue(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_TOKEN_VALUE_LENGTH) return false
  if (FORBIDDEN_CSS_VALUE_RE.test(trimmed)) return false
  return true
}

function validateTokenMap(
  raw: unknown,
  modeName: 'light' | 'dark'
): { ok: true; tokens: Partial<SkinTokenMap> } | { ok: false; message: string } {
  if (!isPlainRecord(raw)) {
    return { ok: false, message: `皮肤字段 ${modeName} 必须是对象` }
  }
  const tokens: Partial<SkinTokenMap> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!ALLOWED_TOKEN_SET.has(key)) {
      return { ok: false, message: `皮肤包含不允许的 CSS 变量键：${key}` }
    }
    if (!isSafeCssValue(value)) {
      return { ok: false, message: `皮肤变量 ${key} 的值不合法或包含不安全内容` }
    }
    tokens[key as SkinTokenKey] = value.trim()
  }
  return { ok: true, tokens }
}

function fallbackPreviewForMode(
  tokens: Partial<SkinTokenMap>,
  mode: 'light' | 'dark'
): SkinPreviewColors {
  const base = BUILTIN_SKINS[0].preview[mode]
  return {
    bg: tokens['--app-bg'] || base.bg,
    sidebar: tokens['--surface-sidebar'] || base.sidebar,
    surface: tokens['--panel-bg'] || base.surface,
    accent: tokens['--brand'] || base.accent,
    text: tokens['--text-main'] || base.text,
    border: tokens['--border-soft'] || base.border
  }
}

function validatePreviewMode(
  raw: unknown,
  tokens: Partial<SkinTokenMap>,
  mode: 'light' | 'dark'
): { ok: true; colors: SkinPreviewColors } | { ok: false; message: string } {
  if (raw === undefined) {
    return { ok: true, colors: fallbackPreviewForMode(tokens, mode) }
  }
  if (!isPlainRecord(raw)) {
    return { ok: false, message: `preview.${mode} 必须是对象` }
  }
  const fallback = fallbackPreviewForMode(tokens, mode)
  const keys: Array<keyof SkinPreviewColors> = ['bg', 'sidebar', 'surface', 'accent', 'text', 'border']
  const colors = { ...fallback }
  for (const key of keys) {
    const val = raw[key]
    if (val === undefined) continue
    if (!isSafeCssValue(val)) {
      return { ok: false, message: `preview.${mode}.${key} 包含不安全的值` }
    }
    colors[key] = val.trim()
  }
  return { ok: true, colors }
}

export function validateSkinPlugin(raw: unknown): SkinValidationResult {
  if (!isPlainRecord(raw)) {
    return { ok: false, message: '皮肤插件必须是 JSON 对象' }
  }

  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!SKIN_ID_RE.test(id)) {
    return {
      ok: false,
      message: '皮肤 id 必须为 2-32 位小写字母、数字、连字符或下划线，且以字母或数字开头'
    }
  }

  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name || name.length > 64) {
    return { ok: false, message: '皮肤名称不能为空且不超过 64 个字符' }
  }

  const version = typeof raw.version === 'string' ? raw.version.trim() : ''
  if (!version || version.length > 32) {
    return { ok: false, message: '皮肤版本号不能为空且不超过 32 个字符' }
  }

  const description = typeof raw.description === 'string' ? raw.description.trim().slice(0, 200) : ''
  const author = typeof raw.author === 'string' && raw.author.trim()
    ? raw.author.trim().slice(0, 64)
    : 'Custom'

  const layoutCheck = validateLayoutConfig(raw.layout)
  if (!layoutCheck.ok) return layoutCheck

  const lightCheck = validateTokenMap(raw.light, 'light')
  if (!lightCheck.ok) return lightCheck
  const darkCheck = validateTokenMap(raw.dark, 'dark')
  if (!darkCheck.ok) return darkCheck

  if (Object.keys(lightCheck.tokens).length === 0 && Object.keys(darkCheck.tokens).length === 0) {
    return { ok: false, message: '皮肤至少需要在 light 或 dark 中定义一个有效令牌' }
  }

  let previewLight: SkinPreviewColors
  let previewDark: SkinPreviewColors
  if (raw.preview === undefined) {
    previewLight = fallbackPreviewForMode(lightCheck.tokens, 'light')
    previewDark = fallbackPreviewForMode(darkCheck.tokens, 'dark')
  } else {
    if (!isPlainRecord(raw.preview)) {
      return { ok: false, message: '皮肤 preview 字段必须是对象' }
    }
    const pl = validatePreviewMode(raw.preview.light, lightCheck.tokens, 'light')
    if (!pl.ok) return pl
    const pd = validatePreviewMode(raw.preview.dark, darkCheck.tokens, 'dark')
    if (!pd.ok) return pd
    previewLight = pl.colors
    previewDark = pd.colors
  }

  return {
    ok: true,
    skin: {
      id,
      name,
      description,
      author,
      version,
      builtin: false,
      layout: layoutCheck.layout,
      preview: {
        light: previewLight,
        dark: previewDark
      },
      light: lightCheck.tokens,
      dark: darkCheck.tokens
    }
  }
}

function loadCustomSkins(): SkinPlugin[] {
  const raw = readLocalStorage(CUSTOM_SKINS_STORAGE_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const valid: SkinPlugin[] = []
    const seen = new Set<string>(BUILTIN_SKIN_IDS)
    for (const item of parsed) {
      const checked = validateSkinPlugin(item)
      if (!checked.ok) continue
      if (seen.has(checked.skin.id)) continue
      seen.add(checked.skin.id)
      valid.push(checked.skin)
    }
    return valid
  } catch {
    return []
  }
}

function saveCustomSkins(skins: SkinPlugin[]): void {
  writeLocalStorage(CUSTOM_SKINS_STORAGE_KEY, JSON.stringify(skins))
}

export function listSkins(): SkinPlugin[] {
  return [...BUILTIN_SKINS, ...loadCustomSkins()]
}

export function getSkin(id: string): SkinPlugin {
  const normalized = (id || '').trim()
  const found = listSkins().find((skin) => skin.id === normalized)
  return found || BUILTIN_SKINS[0]
}

export function loadActiveSkinId(): string {
  const stored = readLocalStorage(ACTIVE_SKIN_STORAGE_KEY)
  if (stored && listSkins().some((skin) => skin.id === stored)) {
    return stored
  }
  return DEFAULT_SKIN_ID
}

export function saveActiveSkinId(id: string): void {
  writeLocalStorage(ACTIVE_SKIN_STORAGE_KEY, id)
}

export function installCustomSkin(jsonText: string): SkinValidationResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return { ok: false, message: '皮肤文件不是有效的 JSON 格式' }
  }

  const checked = validateSkinPlugin(parsed)
  if (!checked.ok) return checked

  if (BUILTIN_SKIN_IDS.has(checked.skin.id)) {
    return {
      ok: false,
      message: `皮肤 id "${checked.skin.id}" 为内置保留名称，请修改为自定义 id 后重新导入`
    }
  }

  const existing = loadCustomSkins()
  const index = existing.findIndex((item) => item.id === checked.skin.id)
  if (index >= 0) {
    existing[index] = checked.skin
  } else {
    if (existing.length >= MAX_CUSTOM_SKINS) {
      return { ok: false, message: `最多只能安装 ${MAX_CUSTOM_SKINS} 个自定义皮肤` }
    }
    existing.push(checked.skin)
  }
  saveCustomSkins(existing)
  return { ok: true, skin: checked.skin }
}

export function uninstallCustomSkin(id: string): boolean {
  if (BUILTIN_SKIN_IDS.has(id)) return false
  const existing = loadCustomSkins()
  const next = existing.filter((item) => item.id !== id)
  if (next.length === existing.length) return false
  saveCustomSkins(next)
  if (readLocalStorage(ACTIVE_SKIN_STORAGE_KEY) === id) {
    saveActiveSkinId(DEFAULT_SKIN_ID)
  }
  return true
}

export function exportSkinTemplate(id: string, layoutOverride?: SkinLayoutOverride | null): string {
  const source = getSkin(id)
  const template: SkinPlugin = {
    id: source.builtin ? `${source.id}-custom` : source.id,
    name: source.builtin ? `${source.name} (自定义)` : source.name,
    description: source.description,
    author: source.builtin ? 'Your Name' : source.author,
    version: source.version,
    layout: { ...resolveEffectiveLayout(source, layoutOverride) },
    preview: {
      light: { ...source.preview.light },
      dark: { ...source.preview.dark }
    },
    light: { ...source.light },
    dark: { ...source.dark }
  }
  return JSON.stringify(template, null, 2)
}

export interface WallpaperApplyOptions {
  active: boolean
  surfaceOpacity: number
  wallpaperBlur: number
  wallpaperDim: number
}

export function applySkinToDocument(
  skin: SkinPlugin,
  resolvedTheme: 'light' | 'dark',
  effectiveLayout?: SkinLayoutConfig | null,
  wallpaper?: WallpaperApplyOptions | null
): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const layout = effectiveLayout ?? resolveSkinLayout(skin)
  const wallpaperActive = Boolean(wallpaper?.active)

  root.dataset.skin = skin.id
  root.dataset.layout = layout.mode
  root.dataset.density = layout.density
  root.dataset.listStyle = layout.listStyle
  root.dataset.wallpaper = wallpaperActive ? 'on' : 'off'

  const style = root.style
  for (const key of ALLOWED_SKIN_TOKEN_KEYS) {
    style.removeProperty(key)
  }
  style.removeProperty('--wallpaper-blur')
  style.removeProperty('--wallpaper-dim')

  const tokenMap = resolvedTheme === 'dark' ? skin.dark : skin.light
  for (const [key, value] of Object.entries(tokenMap)) {
    if (ALLOWED_TOKEN_SET.has(key) && isSafeCssValue(value)) {
      style.setProperty(key, value.trim())
    }
  }

  if (wallpaperActive && wallpaper) {
    const opacity = Math.min(100, Math.max(45, Math.round(wallpaper.surfaceOpacity)))
    const blur = Math.min(24, Math.max(0, Math.round(wallpaper.wallpaperBlur)))
    const dim = Math.min(75, Math.max(0, Math.round(wallpaper.wallpaperDim)))

    style.setProperty('--wallpaper-blur', `${blur}px`)
    style.setProperty('--wallpaper-dim', String(dim / 100))

    const fallbackTokens = BUILTIN_SKINS[0][resolvedTheme]
    const baseSidebar = tokenMap['--surface-sidebar'] || fallbackTokens['--surface-sidebar'] || '#ffffff'
    const basePanel = tokenMap['--panel-bg'] || fallbackTokens['--panel-bg'] || '#ffffff'
    const baseContainerLow = tokenMap['--surface-container-low'] || fallbackTokens['--surface-container-low'] || basePanel
    const baseElevated = tokenMap['--surface-elevated'] || fallbackTokens['--surface-elevated'] || basePanel

    style.setProperty('--app-bg', 'transparent')
    style.setProperty('--surface-sidebar', `color-mix(in srgb, ${baseSidebar} ${opacity}%, transparent)`)
    style.setProperty('--panel-bg', `color-mix(in srgb, ${basePanel} ${opacity}%, transparent)`)
    style.setProperty(
      '--surface-container-low',
      `color-mix(in srgb, ${baseContainerLow} ${Math.min(96, opacity + 4)}%, transparent)`
    )
    style.setProperty(
      '--surface-elevated',
      `color-mix(in srgb, ${baseElevated} ${Math.min(98, opacity + 10)}%, transparent)`
    )
  }
}
