export const ALLOWED_SKIN_TOKEN_KEYS = [
  '--app-bg',
  '--app-bg-soft',
  '--panel-bg',
  '--panel-bg-muted',
  '--surface-sidebar',
  '--surface-elevated',
  '--surface-container-low',
  '--surface-container',
  '--surface-container-high',
  '--surface-container-highest',
  '--surface-overlay',
  '--text-main',
  '--text-secondary',
  '--text-muted',
  '--text-subtle',
  '--brand',
  '--brand-hover',
  '--brand-strong',
  '--brand-soft',
  '--brand-soft-hover',
  '--brand-container',
  '--on-brand',
  '--on-brand-container',
  '--danger',
  '--danger-hover',
  '--danger-soft',
  '--danger-soft-hover',
  '--danger-container',
  '--on-danger',
  '--warning',
  '--warning-soft',
  '--success',
  '--success-soft',
  '--border-soft',
  '--border-strong',
  '--panel-border',
  '--radius-xs',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--radius-xl',
  '--shadow-sm',
  '--shadow-md',
  '--shadow-lg',
  '--font-sans',
  '--font-mono',
  '--scrollbar-thumb',
  '--scrollbar-thumb-hover',
  '--scrollbar-thumb-active'
] as const

export type SkinTokenKey = (typeof ALLOWED_SKIN_TOKEN_KEYS)[number]

export type SkinTokenMap = Record<SkinTokenKey, string>

export type SkinLayoutMode = 'three-pane' | 'top-nav-split' | 'compact-cards'
export type SkinDensity = 'compact' | 'comfortable' | 'airy'
export type SkinListStyle = 'rows' | 'cards' | 'table'

export interface SkinLayoutConfig {
  mode: SkinLayoutMode
  density: SkinDensity
  listStyle: SkinListStyle
}

export interface SkinLayoutOverride {
  mode?: SkinLayoutMode | null
  density?: SkinDensity | null
  listStyle?: SkinListStyle | null
}

export const DEFAULT_SKIN_LAYOUT: SkinLayoutConfig = {
  mode: 'three-pane',
  density: 'comfortable',
  listStyle: 'rows'
}

export interface SkinPreviewColors {
  bg: string
  sidebar: string
  surface: string
  accent: string
  text: string
  border: string
}

export interface SkinPlugin {
  id: string
  name: string
  description: string
  author: string
  version: string
  builtin?: boolean
  layout?: SkinLayoutConfig
  preview: {
    light: SkinPreviewColors
    dark: SkinPreviewColors
  }
  light: Partial<SkinTokenMap>
  dark: Partial<SkinTokenMap>
}

export type SkinValidationResult =
  | { ok: true; skin: SkinPlugin }
  | { ok: false; message: string }
