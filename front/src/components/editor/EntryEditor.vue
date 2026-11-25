<template>
  <EditorHost
    :inline="inline"
    :open="open"
    :title="modalTitle"
    @close="emit('update:open', false)"
  >
    <div class="editor-content" @focusin="emit('focus-field', $event)">
      <div v-if="!editingId" class="kind-segmented-selector" role="radiogroup" aria-label="条目类型">
        <button
          v-for="item in kindOptions"
          :key="item.kind"
          type="button"
          class="kind-pill-btn"
          :class="{ 'is-active': form.kind === item.kind }"
          :aria-checked="form.kind === item.kind"
          role="radio"
          @click="emit('switch-kind', item.kind)"
        >
          <UiIcon :name="item.icon" :size="14" />
          <span>{{ item.label }}</span>
        </button>
      </div>

      <form
        id="entry-editor-form"
        class="editor-form"
        autocomplete="off"
        @submit.prevent="handleFormSubmit"
      >
        <div class="editor-row">
          <label class="editor-label" for="editor-field-title">名称</label>
          <div class="editor-control">
            <UiInput
              id="editor-field-title"
              :model-value="form.title"
              autocomplete="off"
              placeholder="例如 GitHub"
              :error="titleError"
              @update:model-value="handleTitleInput"
            />
          </div>
        </div>

        <template v-if="form.kind === 'login'">
          <div class="editor-row">
            <label class="editor-label" for="editor-field-username">账号</label>
            <div class="editor-control">
              <UiInput
                id="editor-field-username"
                :model-value="form.username || ''"
                autocomplete="off"
                placeholder="用户名 / 账号名"
                @update:model-value="updateField('username', $event)"
              />
            </div>
          </div>

          <div class="editor-row">
            <label class="editor-label" for="editor-field-password">密码</label>
            <div class="editor-control">
              <div class="editor-input-box">
                <input
                  id="editor-field-password"
                  class="editor-native-input is-mono"
                  :value="form.password || ''"
                  :type="showPassword ? 'text' : 'password'"
                  autocomplete="new-password"
                  placeholder="输入或生成强密码"
                  @input="updateField('password', ($event.target as HTMLInputElement).value)"
                />
                <div class="editor-password-actions">
                  <button
                    class="editor-inline-btn"
                    type="button"
                    aria-label="快速生成强密码"
                    title="快速生成强密码"
                    @click.prevent.stop="quickGeneratePassword"
                  >
                    <UiIcon name="wand" :size="15" />
                  </button>
                  <button
                    class="editor-inline-btn"
                    type="button"
                    aria-label="自定义生成规则"
                    title="自定义生成规则"
                    @click.prevent.stop="emit('open-generator')"
                  >
                    <UiIcon name="settings" :size="15" />
                  </button>
                  <button
                    class="editor-inline-btn"
                    type="button"
                    :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                    :aria-pressed="showPassword"
                    :title="showPassword ? '隐藏密码' : '显示密码'"
                    @click.prevent.stop="showPassword = !showPassword"
                  >
                    <UiIcon :name="showPassword ? 'eye-off' : 'eye'" :size="15" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="editor-row" :class="{ 'editor-row--top': isMultilineDomain }">
            <label class="editor-label" for="editor-field-domain">网站</label>
            <div class="editor-control">
              <UiInput
                id="editor-field-domain"
                :model-value="domainText"
                :type="isMultilineDomain ? 'textarea' : 'text'"
                :rows="isMultilineDomain ? 2 : undefined"
                autocomplete="off"
                :placeholder="form.autofillMatchMode === 'url-prefix' ? 'https://example.com/account' : 'example.com（多个用逗号分隔）'"
                @update:model-value="emit('update-domain', $event)"
              />
            </div>
          </div>

          <div v-if="showEmailField" class="editor-row">
            <label class="editor-label" for="editor-field-email">邮箱</label>
            <div class="editor-control">
              <div class="editor-input-box">
                <input
                  id="editor-field-email"
                  class="editor-native-input"
                  :value="form.email || ''"
                  type="text"
                  inputmode="email"
                  autocomplete="off"
                  placeholder="邮箱地址"
                  @input="updateField('email', ($event.target as HTMLInputElement).value)"
                />
                <button
                  type="button"
                  class="editor-inline-btn is-remove"
                  aria-label="移除邮箱字段"
                  title="清空并移除"
                  @click.prevent="removeOptionalField('email')"
                >
                  <UiIcon name="close" :size="14" />
                </button>
              </div>
            </div>
          </div>

          <div v-if="showPhoneField" class="editor-row">
            <label class="editor-label" for="editor-field-phone">手机</label>
            <div class="editor-control">
              <div class="editor-input-box">
                <input
                  id="editor-field-phone"
                  class="editor-native-input"
                  :value="form.phone || ''"
                  type="text"
                  inputmode="tel"
                  autocomplete="off"
                  placeholder="手机号"
                  @input="updateField('phone', ($event.target as HTMLInputElement).value)"
                />
                <button
                  type="button"
                  class="editor-inline-btn is-remove"
                  aria-label="移除手机字段"
                  title="清空并移除"
                  @click.prevent="removeOptionalField('phone')"
                >
                  <UiIcon name="close" :size="14" />
                </button>
              </div>
            </div>
          </div>

          <template v-if="showTotpField">
            <div class="editor-row">
              <label class="editor-label" for="editor-field-totp">TOTP</label>
              <div class="editor-control">
                <div class="editor-input-box">
                  <input
                    id="editor-field-totp"
                    class="editor-native-input is-mono"
                    :value="form.totpSecret || ''"
                    type="text"
                    autocomplete="off"
                    placeholder="Base32 密钥或 otpauth:// 链接"
                    @input="updateField('totpSecret', ($event.target as HTMLInputElement).value)"
                  />
                  <button
                    v-if="showQrImagePicker"
                    type="button"
                    class="editor-inline-btn"
                    :disabled="qrImageBusy"
                    aria-label="从图片识别 TOTP 二维码"
                    title="从图片识别 TOTP 二维码"
                    @click.prevent="chooseQrImage"
                  >
                    <span v-if="qrImageBusy" class="editor-mini-spinner" aria-hidden="true" />
                    <UiIcon v-else name="qr" :size="15" />
                  </button>
                  <button
                    type="button"
                    class="editor-inline-btn is-remove"
                    aria-label="移除 TOTP 字段"
                    title="清空并移除"
                    @click.prevent="removeOptionalField('totp')"
                  >
                    <UiIcon name="close" :size="14" />
                  </button>
                </div>
              </div>
            </div>

            <div v-if="editingId && form.totpSecret" class="totp-preview-bar">
              <div class="totp-preview-copy">
                <span class="totp-preview-label">当前动态口令</span>
                <strong class="totp-preview-code">{{ totpCode || '------' }}</strong>
              </div>
              <UiButton variant="ghost" size="sm" icon-only aria-label="刷新验证码" title="刷新验证码" @click.prevent="emit('refresh-totp')">
                <UiIcon name="refresh" :size="15" />
              </UiButton>
            </div>
          </template>

          <input
            v-if="showQrImagePicker"
            ref="qrImageInput"
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp,image/bmp,.png,.jpg,.jpeg,.webp,.bmp"
            @change="handleQrImageSelected"
          />

          <div v-if="showNoteField" class="editor-row editor-row--top">
            <label class="editor-label" for="editor-field-note">备注</label>
            <div class="editor-control editor-control--with-remove">
              <UiInput
                id="editor-field-note"
                :model-value="form.note || ''"
                type="textarea"
                :rows="3"
                autocomplete="off"
                placeholder="安全问题、登录提示等"
                @update:model-value="updateField('note', $event)"
              />
              <button
                type="button"
                class="editor-inline-btn is-remove"
                aria-label="移除备注字段"
                title="清空并移除"
                @click.prevent="removeOptionalField('note')"
              >
                <UiIcon name="close" :size="14" />
              </button>
            </div>
          </div>

          <div v-if="showAutofillRules" class="editor-advanced-body">
            <div class="editor-advanced-head">
              <span class="editor-advanced-head__title">自动填充规则</span>
              <button
                type="button"
                class="editor-inline-btn is-remove"
                aria-label="收起并重置自动填充规则"
                title="恢复默认并隐藏"
                @click.prevent="removeOptionalField('autofill')"
              >
                <UiIcon name="close" :size="14" />
              </button>
            </div>

            <label class="autofill-rule-field">
              <span class="editor-label">匹配方式</span>
              <select
                class="editor-select"
                :value="form.autofillMatchMode || 'base-domain'"
                aria-label="自动填充匹配方式"
                @change="updateField('autofillMatchMode', ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="option in autofillMatchModeOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>

            <div class="account-source-field">
              <span class="editor-label">填充账号</span>
              <div class="account-source-options" role="radiogroup" aria-label="自动填充账号来源">
                <label
                  v-for="option in loginAccountSourceOptions"
                  :key="option.value"
                  class="account-source-pill"
                  :class="{ 'is-active': (form.loginAccountSource || 'auto') === option.value }"
                >
                  <input
                    type="radio"
                    name="loginAccountSource"
                    :value="option.value"
                    :checked="(form.loginAccountSource || 'auto') === option.value"
                    @change="updateField('loginAccountSource', option.value)"
                  />
                  <span>{{ option.label }}</span>
                </label>
              </div>
            </div>
          </div>

          <div v-if="availableSemanticAdditions.length" class="semantic-add-bar" aria-label="快捷添加常用字段">
            <button
              v-for="item in availableSemanticAdditions"
              :key="item.key"
              type="button"
              class="semantic-add-chip"
              @click="addOptionalField(item.key)"
            >
              <UiIcon name="plus" :size="12" />
              <span>{{ item.label }}</span>
            </button>
          </div>
        </template>

        <template v-else-if="form.kind !== 'folder'">
          <div class="editor-row editor-row--top">
            <label class="editor-label" for="editor-field-note-alt">备注</label>
            <div class="editor-control">
              <UiInput
                id="editor-field-note-alt"
                :model-value="form.note || ''"
                type="textarea"
                :rows="4"
                autocomplete="off"
                :placeholder="form.kind === 'secure-note' ? '输入需要加密保存的内容' : '补充说明'"
                @update:model-value="updateField('note', $event)"
              />
            </div>
          </div>
        </template>

        <CustomFieldEditor
          v-if="form.kind !== 'folder'"
          :model-value="form.customFields || []"
          @update:model-value="emit('update-custom-fields', $event)"
        />
      </form>
    </div>

    <template #footer>
      <UiButton variant="secondary" @click="emit('update:open', false)">取消</UiButton>
      <UiButton variant="primary" type="submit" form="entry-editor-form" :loading="busy">
        <UiIcon name="check" :size="15" />
        <span>保存</span>
      </UiButton>
    </template>
  </EditorHost>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, ref, watch } from 'vue'
import { UiButton, UiIcon, UiInput, UiModal, type UiIconName } from '../ui'
import CustomFieldEditor from './CustomFieldEditor.vue'
import { showToast } from '../../services/uiFeedback'
import { entryKindLabel } from '../../services/entryKinds.ts'
import { generatePassword } from '../../services/credentialGenerator.ts'
import type { AutofillMatchMode, EntryKind, LoginAccountSource, VaultCustomField, VaultEntry } from '../../types'

const EditorHost = defineComponent({
  name: 'EditorHost',
  props: {
    inline: { type: Boolean, default: false },
    open: { type: Boolean, required: true },
    title: { type: String, required: true }
  },
  emits: ['close'],
  setup(hostProps, { slots, emit: hostEmit }) {
    return () => {
      if (hostProps.inline) {
        if (!hostProps.open) return null
        return h('section', { class: 'editor-inline-shell' }, [
          h('header', { class: 'editor-inline-header' }, [
            h('h2', { class: 'editor-inline-title' }, hostProps.title),
            h(
              'button',
              {
                type: 'button',
                class: 'editor-inline-close',
                'aria-label': '关闭',
                title: '关闭',
                onClick: () => hostEmit('close')
              },
              [h(UiIcon, { name: 'close', size: 16 })]
            )
          ]),
          h('div', { class: 'editor-inline-body' }, slots.default?.()),
          slots.footer ? h('footer', { class: 'editor-inline-footer' }, slots.footer()) : null
        ])
      }

      return h(
        UiModal,
        {
          open: hostProps.open,
          title: hostProps.title,
          size: 'lg',
          fullscreenOnMobile: true,
          onClose: () => hostEmit('close')
        },
        {
          default: slots.default,
          footer: slots.footer
        }
      )
    }
  }
})

const kindOptions: Array<{ kind: EntryKind; label: string; icon: UiIconName }> = [
  { kind: 'login', label: '登录', icon: 'lock' },
  { kind: 'secure-note', label: '笔记', icon: 'edit' },
  { kind: 'card', label: '卡片', icon: 'shield' },
  { kind: 'identity', label: '身份', icon: 'info' },
  { kind: 'api-key', label: '密钥', icon: 'key' },
  { kind: 'folder', label: '分组', icon: 'folder' }
]

type EditorField = 'title' | 'username' | 'email' | 'password' | 'phone' | 'autofillMatchMode' | 'loginAccountSource' | 'totpSecret' | 'note'

const props = withDefaults(
  defineProps<{
    open: boolean
    inline?: boolean
    form: VaultEntry
    domainText: string
    editingId: string
    busy: boolean
    totpCode: string
    autofillMatchModeOptions: Array<{ label: string; value: AutofillMatchMode }>
    loginAccountSourceOptions: Array<{ label: string; value: LoginAccountSource }>
    showQrImagePicker: boolean
    qrImageBusy: boolean
  }>(),
  {
    inline: false
  }
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  'switch-kind': [kind: EntryKind]
  'update-field': [field: EditorField, value: unknown]
  'update-domain': [value: string]
  submit: []
  'focus-field': [event: FocusEvent]
  'refresh-totp': []
  'import-totp-qr-image': [file: File, editingId: string, formId: string]
  'open-generator': []
  'update-custom-fields': [value: VaultCustomField[]]
}>()

type OptionalSemanticKey = 'email' | 'phone' | 'totp' | 'note' | 'autofill'

const showPassword = ref(false)
const enabledOptionalFields = ref<Set<OptionalSemanticKey>>(new Set())
const titleError = ref('')
const qrImageInput = ref<HTMLInputElement | null>(null)
let qrImageOrigin: { editingId: string; formId: string } | null = null

const modalTitle = computed(() =>
  props.editingId ? `编辑${entryKindLabel(props.form.kind)}` : `新建${entryKindLabel(props.form.kind)}`
)

const isMultilineDomain = computed(() => props.domainText.includes('\n'))

const showEmailField = computed(() => Boolean(props.form.email?.trim()) || enabledOptionalFields.value.has('email'))
const showPhoneField = computed(() => Boolean(props.form.phone?.trim()) || enabledOptionalFields.value.has('phone'))
const showTotpField = computed(() => Boolean(props.form.totpSecret?.trim()) || enabledOptionalFields.value.has('totp'))
const showNoteField = computed(() => Boolean(props.form.note?.trim()) || enabledOptionalFields.value.has('note'))
const showAutofillRules = computed(() => (
  (Boolean(props.form.autofillMatchMode) && props.form.autofillMatchMode !== 'base-domain')
  || (Boolean(props.form.loginAccountSource) && props.form.loginAccountSource !== 'auto')
  || enabledOptionalFields.value.has('autofill')
))

const availableSemanticAdditions = computed<Array<{ key: OptionalSemanticKey; label: string }>>(() => {
  const items: Array<{ key: OptionalSemanticKey; label: string }> = []
  if (!showEmailField.value) items.push({ key: 'email', label: '邮箱' })
  if (!showPhoneField.value) items.push({ key: 'phone', label: '手机' })
  if (!showTotpField.value) items.push({ key: 'totp', label: 'TOTP 验证码' })
  if (!showNoteField.value) items.push({ key: 'note', label: '备注' })
  if (!showAutofillRules.value) items.push({ key: 'autofill', label: '自动填充规则' })
  return items
})

function addOptionalField(key: OptionalSemanticKey): void {
  const next = new Set(enabledOptionalFields.value)
  next.add(key)
  enabledOptionalFields.value = next
}

function removeOptionalField(key: OptionalSemanticKey): void {
  const next = new Set(enabledOptionalFields.value)
  next.delete(key)
  enabledOptionalFields.value = next
  if (key === 'email') updateField('email', '')
  else if (key === 'phone') updateField('phone', '')
  else if (key === 'totp') updateField('totpSecret', '')
  else if (key === 'note') updateField('note', '')
  else if (key === 'autofill') {
    updateField('autofillMatchMode', 'base-domain')
    updateField('loginAccountSource', 'auto')
  }
}

watch(
  [() => props.open, () => props.editingId],
  () => {
    showPassword.value = false
    titleError.value = ''
    qrImageOrigin = null
    enabledOptionalFields.value = new Set()
  },
  { immediate: true }
)

function updateField(field: EditorField, value: unknown) {
  emit('update-field', field, String(value ?? ''))
}

function handleTitleInput(value: string) {
  if (titleError.value && value.trim()) titleError.value = ''
  updateField('title', value)
}

function handleFormSubmit() {
  if (!props.form.title.trim()) {
    titleError.value = '请输入条目名称'
    return
  }
  titleError.value = ''
  emit('submit')
}

function quickGeneratePassword() {
  const generated = generatePassword({ length: 20 })
  updateField('password', generated)
  showPassword.value = true
  showToast('已生成强密码')
}

function chooseQrImage() {
  const input = qrImageInput.value
  if (!input || props.qrImageBusy) return
  qrImageOrigin = { editingId: props.editingId, formId: props.form.id }
  input.value = ''
  input.click()
}

function handleQrImageSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.item(0)
  const origin = qrImageOrigin
  input.value = ''
  qrImageOrigin = null
  if (file && origin) emit('import-totp-qr-image', file, origin.editingId, origin.formId)
}
</script>

<style scoped>
.editor-inline-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background-color: var(--panel-bg);
  color: var(--text-main);
}

.editor-inline-shell :deep(.editor-inline-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-soft);
  flex-shrink: 0;
}

.editor-inline-shell :deep(.editor-inline-title) {
  margin: 0;
  font-size: var(--app-font-lg);
  font-weight: 600;
  color: var(--text-main);
}

.editor-inline-shell :deep(.editor-inline-close) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.editor-inline-shell :deep(.editor-inline-close:hover) {
  background-color: var(--surface-container-high);
  color: var(--text-main);
}

.editor-inline-shell :deep(.editor-inline-body) {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px 18px;
}

.editor-inline-shell :deep(.editor-inline-footer) {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border-soft);
  background-color: var(--surface-container-low);
  flex-shrink: 0;
}

.editor-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
}

.kind-segmented-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.kind-pill-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: var(--control-height-sm);
  padding: 0 11px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-full);
  background-color: var(--surface-container-low);
  color: var(--text-secondary);
  font-size: var(--app-font-sm);
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.kind-pill-btn:hover {
  background-color: var(--surface-container);
  color: var(--text-main);
}

.kind-pill-btn.is-active {
  background-color: var(--brand-soft);
  border-color: var(--brand);
  color: var(--brand);
  font-weight: 600;
}

.kind-pill-btn:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.editor-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  touch-action: pan-y;
}

.editor-row {
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.editor-control--with-remove {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.editor-control--with-remove > :first-child {
  flex: 1 1 auto;
  min-width: 0;
}

.editor-inline-btn.is-remove {
  color: var(--text-muted);
}

.editor-inline-btn.is-remove:hover {
  color: var(--danger);
  background-color: var(--danger-soft);
}

.editor-advanced-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.editor-advanced-head__title {
  font-size: var(--app-font-xs);
  font-weight: 600;
  color: var(--text-secondary);
}

.semantic-add-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 2px;
}

.semantic-add-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 9px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--app-font-xs);
  font-weight: 500;
  cursor: pointer;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.semantic-add-chip:hover {
  border-style: solid;
  border-color: var(--brand);
  background-color: var(--brand-soft);
  color: var(--brand);
}

.editor-row--top {
  align-items: start;
}

.editor-row--top .editor-label {
  padding-top: 8px;
}

.editor-label {
  font-size: var(--app-font-sm);
  font-weight: 500;
  color: var(--text-secondary);
  line-height: 1.3;
  user-select: none;
}

.editor-control {
  min-width: 0;
}

.editor-input-box {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: var(--control-height-md);
  padding: 0 8px 0 10px;
  background-color: var(--panel-bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard);
}

.editor-input-box:hover {
  border-color: color-mix(in srgb, var(--brand) 52%, var(--border-strong));
}

.editor-input-box:focus-within {
  border-color: var(--brand);
  box-shadow: var(--focus-ring);
}

.editor-native-input {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--text-main);
  font-size: var(--app-font-base);
  line-height: 1.45;
  padding: 6px 0;
  outline: none;
}

.editor-native-input::placeholder {
  color: var(--text-muted);
}

.editor-native-input.is-mono {
  font-family: var(--font-mono);
  font-variant-ligatures: none;
  letter-spacing: 0.01em;
}

.editor-password-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.editor-inline-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.editor-inline-btn:hover:not(:disabled) {
  background-color: var(--surface-container-high);
  color: var(--brand);
}

.editor-inline-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.editor-mini-spinner {
  width: 14px;
  height: 14px;
  border-radius: var(--radius-full);
  border: 2px solid var(--border-strong);
  border-top-color: var(--brand);
  animation: editor-spin 0.72s linear infinite;
}

@keyframes editor-spin {
  to {
    transform: rotate(360deg);
  }
}

.editor-section-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background-color: var(--surface-container-low);
  color: var(--text-main);
  font-size: var(--app-font-sm);
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);
}

.editor-section-toggle:hover {
  background-color: var(--surface-container);
}

.editor-section-toggle.is-expanded {
  border-color: color-mix(in srgb, var(--brand) 36%, var(--border-soft));
}

.editor-section-toggle-left {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.editor-section-chevron {
  color: var(--text-muted);
}

.editor-advanced-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background-color: var(--surface-container-low);
}

.autofill-rule-field,
.account-source-field {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}

.editor-select {
  width: 100%;
  min-height: var(--control-height-md);
  padding: 0 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background-color: var(--panel-bg);
  color: var(--text-main);
  font-size: var(--app-font-base);
  outline: none;
  box-sizing: border-box;
}

.editor-select:focus {
  border-color: var(--brand);
  box-shadow: var(--focus-ring);
}

.account-source-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.account-source-pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-full);
  background-color: var(--panel-bg);
  color: var(--text-secondary);
  font-size: var(--app-font-sm);
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.account-source-pill input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.account-source-pill.is-active {
  background-color: var(--brand-soft);
  border-color: var(--brand);
  color: var(--brand);
  font-weight: 600;
}

.totp-preview-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background-color: var(--panel-bg);
  border: 1px solid var(--border-soft);
}

.totp-preview-copy {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.totp-preview-label {
  font-size: var(--app-font-xs);
  color: var(--text-muted);
}

.totp-preview-code {
  font-family: var(--font-mono);
  font-size: var(--app-font-lg);
  letter-spacing: 0.14em;
  color: var(--brand);
}

@media (max-width: 620px) {
  .editor-row,
  .autofill-rule-field,
  .account-source-field {
    grid-template-columns: 70px minmax(0, 1fr);
    gap: 8px;
  }

  .editor-advanced-body {
    padding: 10px;
  }
}
</style>
