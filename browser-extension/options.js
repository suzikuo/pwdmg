const { BUILTIN_SKINS, MAX_CUSTOM_SKINS, MAX_SKIN_BYTES, validateSkin, getSkin, getLayout, saveState, createController } = MyPwdMgAppearance
const root = document.documentElement
const controls = document.getElementById('appearanceControls')
const skinGrid = document.getElementById('skinGrid')
const themeSelect = document.getElementById('themeSelect')
const layoutInputs = {
  mode: document.getElementById('modeSelect'),
  listStyle: document.getElementById('listStyleSelect'),
  density: document.getElementById('densitySelect')
}
const fileInput = document.getElementById('skinFile')
const deleteButton = document.getElementById('deleteSkin')
const resetButton = document.getElementById('resetLayout')
const status = document.getElementById('settingsStatus')
let state
let shownTheme
let shownSkins = ''
let saving = false

function setStatus(message, error = false) {
  status.textContent = message
  status.toggleAttribute('data-error', error)
}

function skinChoice(skin, theme) {
  const label = document.createElement('label')
  label.className = 'skin-choice'
  const radio = document.createElement('input')
  radio.type = 'radio'
  radio.name = 'skin'
  radio.value = skin.id
  const swatch = document.createElement('span')
  swatch.className = 'skin-swatch'
  swatch.setAttribute('aria-hidden', 'true')
  for (const [name, color] of Object.entries(skin.preview[theme])) {
    swatch.style.setProperty(`--swatch-${name}`, color)
  }
  const name = document.createElement('strong')
  name.textContent = skin.builtin ? skin.name.split(' · ')[0] : skin.name
  label.append(radio, swatch, name)
  return label
}

function render(nextState, theme) {
  state = nextState
  const customSkins = JSON.stringify(state.customSkins)
  if (shownTheme !== theme || shownSkins !== customSkins) {
    const focused = skinGrid.contains(document.activeElement) ? document.activeElement.value : ''
    skinGrid.replaceChildren(...[...BUILTIN_SKINS, ...state.customSkins].map((skin) => skinChoice(skin, theme)))
    if (focused) {
      const radio = [...skinGrid.querySelectorAll('input')].find((input) => input.value === focused)
      radio?.focus({ preventScroll: true })
    }
    shownTheme = theme
    shownSkins = customSkins
  }
  for (const radio of skinGrid.querySelectorAll('input')) radio.checked = radio.value === state.skinId
  const selected = getSkin(state)
  themeSelect.value = state.theme
  for (const [key, select] of Object.entries(layoutInputs)) select.value = state.layout[key] || ''
  deleteButton.hidden = Boolean(selected.builtin)
  resetButton.disabled = !Object.keys(state.layout).length
}

async function update(next, message) {
  if (!state) return
  if (saving) {
    render(state, shownTheme)
    return
  }
  saving = true
  try {
    await saveState(next)
    setStatus(message)
  } catch (error) {
    render(state, shownTheme)
    setStatus(error.message || '无法保存外观设置。', true)
  } finally {
    saving = false
  }
}

const appearance = createController(() => root, render)
void appearance.refresh().then(() => {
  controls.disabled = false
  setStatus('')
}).catch(() => setStatus('无法读取外观设置，请重新打开此页面。', true))

skinGrid.addEventListener('change', (event) => {
  if (event.target.name === 'skin') void update({ ...state, skinId: event.target.value }, '已切换皮肤。')
})

themeSelect.addEventListener('change', () => {
  void update({ ...state, theme: themeSelect.value }, '已更新主题。')
})

for (const [key, select] of Object.entries(layoutInputs)) {
  select.addEventListener('change', () => {
    void update({ ...state, layout: { ...state.layout, [key]: select.value } }, '已更新布局。')
  })
}

resetButton.addEventListener('click', () => {
  void update({ ...state, layout: {} }, '已恢复当前皮肤的布局。')
})

document.getElementById('importSkin').addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', async () => {
  const [file] = fileInput.files
  fileInput.value = ''
  if (!file || !state || saving) return
  try {
    if (file.size > MAX_SKIN_BYTES) throw Error('皮肤文件需小于 64 KiB。')
    const text = await file.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      throw Error('皮肤文件不是有效的 JSON。')
    }
    const skin = validateSkin(data)
    const oldSkin = state.customSkins.find((item) => item.id === skin.id)
    if (!oldSkin && state.customSkins.length >= MAX_CUSTOM_SKINS) throw Error('最多可安装 24 套自定义皮肤。')
    const customSkins = oldSkin
      ? state.customSkins.map((item) => item.id === skin.id ? skin : item)
      : [...state.customSkins, skin]
    await update({ ...state, skinId: skin.id, customSkins }, `已${oldSkin ? '更新' : '导入'}「${skin.name}」。`)
  } catch (error) {
    setStatus(error.message || '无法导入皮肤。', true)
  }
})

deleteButton.addEventListener('click', () => {
  const skin = getSkin(state)
  if (skin.builtin || !window.confirm(`删除自定义皮肤「${skin.name}」？`)) return
  const customSkins = state.customSkins.filter((item) => item.id !== skin.id)
  void update({ ...state, customSkins }, `已删除「${skin.name}」。`)
})

document.getElementById('exportSkin').addEventListener('click', () => {
  const { builtin, ...skin } = getSkin(state)
  const exported = {
    ...skin,
    id: builtin ? `${skin.id}-custom` : skin.id,
    name: builtin ? `${skin.name}（自定义）` : skin.name,
    layout: getLayout(state, skin)
  }
  const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${exported.id}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
})
