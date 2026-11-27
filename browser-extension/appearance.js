(() => {
  const STORAGE_KEY = 'extensionAppearance'
  const BUILTIN_SKINS = globalThis.MyPwdMgBuiltinSkins
  const DEFAULT_SKIN = BUILTIN_SKINS[0]
  const MAX_CUSTOM_SKINS = 24
  const MAX_SKIN_BYTES = 64 * 1024
  const TOKEN_NAMES = new Set([
    ...Object.keys(DEFAULT_SKIN.light), '--font-sans', '--font-mono'
  ])
  const UNSAFE_VALUE = /(?:url\s*\(|expression\s*\(|@import|javascript:|data:|\/\*|\*\/|[;{}<>\\]|[\r\n\0])/i
  const THEMES = ['system', 'light', 'dark']
  const LAYOUT_VALUES = {
    mode: ['three-pane', 'top-nav-split', 'compact-cards'],
    density: ['compact', 'comfortable', 'airy'],
    listStyle: ['rows', 'cards', 'table']
  }
  const PREVIEW_TOKENS = {
    bg: '--app-bg', sidebar: '--surface-sidebar', surface: '--panel-bg',
    accent: '--brand', text: '--text-main', border: '--border-soft'
  }
  const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  const isSafeToken = (value) => typeof value === 'string' && value.trim() &&
    value.trim().length <= 300 && !UNSAFE_VALUE.test(value)

  function layoutOverrides(layout = {}) {
    return Object.fromEntries(Object.entries(LAYOUT_VALUES).flatMap(([key, values]) =>
      values.includes(layout?.[key]) ? [[key, layout[key]]] : []
    ))
  }

  function validateSkin(raw) {
    if (!isRecord(raw)) throw Error('皮肤必须是 JSON 对象。')
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    const version = typeof raw.version === 'string' ? raw.version.trim() : ''
    if (!/^[a-z0-9][a-z0-9-_]{1,31}$/.test(id)) throw Error('皮肤 ID 需为 2–32 位小写字母、数字、下划线或连字符，并以字母或数字开头。')
    if (BUILTIN_SKINS.some((skin) => skin.id === id)) throw Error('此 ID 已用于内置皮肤，请在文件中修改 ID 后重试。')
    if (!name || name.length > 64 || !version || version.length > 32) throw Error('皮肤名称和版本不能为空，长度分别限 64 和 32 个字符。')
    const layout = { ...DEFAULT_SKIN.layout }
    if (raw.layout !== undefined) {
      if (!isRecord(raw.layout)) throw Error('皮肤布局必须是对象。')
      for (const [key, values] of Object.entries(LAYOUT_VALUES)) {
        if (raw.layout[key] === undefined) continue
        if (!values.includes(raw.layout[key])) throw Error(`无效的布局设置 ${key}。`)
        layout[key] = raw.layout[key]
      }
    }
    const skin = {
      id, name, version, layout, preview: {},
      author: typeof raw.author === 'string' ? raw.author.trim().slice(0, 64) || 'Custom' : 'Custom',
      description: typeof raw.description === 'string' ? raw.description.trim().slice(0, 200) : ''
    }
    if (raw.preview !== undefined && !isRecord(raw.preview)) throw Error('预览必须是对象。')
    for (const mode of ['light', 'dark']) {
      if (!isRecord(raw[mode])) throw Error(`皮肤缺少 ${mode} 配色对象。`)
      skin[mode] = {}
      for (const [key, value] of Object.entries(raw[mode])) {
        if (!TOKEN_NAMES.has(key) || !isSafeToken(value)) throw Error(`不支持的皮肤变量或变量值 ${key}。`)
        skin[mode][key] = value.trim()
      }
      const preview = raw.preview?.[mode]
      if (preview !== undefined && !isRecord(preview)) throw Error(`无效的 ${mode} 预览。`)
      skin.preview[mode] = {}
      for (const [key, token] of Object.entries(PREVIEW_TOKENS)) {
        const value = preview?.[key]
        if (value !== undefined && !isSafeToken(value)) throw Error(`无效的预览变量 ${key}。`)
        skin.preview[mode][key] = value?.trim() || skin[mode][token] || DEFAULT_SKIN.preview[mode][key]
      }
    }
    if (!Object.keys(skin.light).length && !Object.keys(skin.dark).length) throw Error('皮肤至少需要一个颜色或样式变量。')
    return skin
  }

  function normalizeState(raw) {
    const customSkins = []
    const seen = new Set()
    for (const item of Array.isArray(raw?.customSkins) ? raw.customSkins.slice(0, MAX_CUSTOM_SKINS) : []) {
      try {
        const skin = validateSkin(item)
        if (seen.has(skin.id)) continue
        seen.add(skin.id)
        customSkins.push(skin)
      } catch {
        // An invalid stored skin does not prevent the extension from opening.
      }
    }
    const skinId = [...BUILTIN_SKINS, ...customSkins].some((skin) => skin.id === raw?.skinId)
      ? raw.skinId : DEFAULT_SKIN.id
    return {
      skinId, customSkins, layout: layoutOverrides(raw?.layout),
      theme: THEMES.includes(raw?.theme) ? raw.theme : 'system'
    }
  }

  function getSkin(state) {
    return [...BUILTIN_SKINS, ...state.customSkins].find((skin) => skin.id === state.skinId) || DEFAULT_SKIN
  }

  function getLayout(state, skin = getSkin(state)) {
    return { ...skin.layout, ...state.layout }
  }

  async function saveState(next) {
    await chrome.storage.local.set({ [STORAGE_KEY]: normalizeState(next) })
  }

  function createController(getRoot, onApply) {
    const systemDark = matchMedia('(prefers-color-scheme: dark)')
    let state
    let ready
    let disposed = false

    function apply() {
      const root = getRoot()
      if (disposed || !root) return
      const skin = state ? getSkin(state) : DEFAULT_SKIN
      const preference = state?.theme || 'system'
      const theme = preference === 'system' ? (systemDark.matches ? 'dark' : 'light') : preference
      const { mode, density, listStyle } = state ? getLayout(state, skin) : skin.layout
      root.dataset.theme = theme
      root.dataset.layout = mode
      root.dataset.density = density
      root.dataset.listStyle = listStyle
      for (const name of TOKEN_NAMES) {
        if (skin[theme][name]) root.style.setProperty(name, skin[theme][name])
        else root.style.removeProperty(name)
      }
      if (state) onApply?.(state, theme)
    }

    function onStorageChanged(changes, area) {
      if (area !== 'local' || !Object.hasOwn(changes, STORAGE_KEY)) return
      state = normalizeState(changes[STORAGE_KEY].newValue)
      apply()
    }

    return {
      refresh() {
        apply()
        if (!ready) {
          systemDark.addEventListener('change', apply)
          chrome.storage.onChanged.addListener(onStorageChanged)
          ready = chrome.storage.local.get(STORAGE_KEY).then((result) => {
            state ??= normalizeState(result[STORAGE_KEY])
            apply()
            return state
          })
        }
        return ready
      },
      dispose() {
        disposed = true
        systemDark.removeEventListener('change', apply)
        chrome.storage.onChanged.removeListener(onStorageChanged)
      }
    }
  }

  globalThis.MyPwdMgAppearance = {
    BUILTIN_SKINS, DEFAULT_SKIN, MAX_CUSTOM_SKINS, MAX_SKIN_BYTES,
    validateSkin, getSkin, getLayout, saveState, createController
  }
})()
