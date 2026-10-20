<template>
  <van-popup
    :show="open"
    position="bottom"
    class="editor-popup"
    :duration="0.14"
    lazy-render
    @update:show="emit('update:open', $event)"
  >
    <div class="sheet-inner" @focusin="emit('focus-field', $event)">
      <van-nav-bar safe-area-inset-top :title="editingId ? `编辑${entryKindLabel(form.kind)}` : `新建${entryKindLabel(form.kind)}`" left-arrow @click-left="emit('update:open', false)" />
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
          <van-icon :name="item.icon" />
          <span>{{ item.label }}</span>
        </button>
      </div>
      <van-form id="entry-editor-form" class="editor-form" autocomplete="off" @submit="emit('submit')">
        <van-field class="editor-field editor-field-single" :model-value="form.title" label="名称" autocomplete="off" placeholder="例如 Github" enterkeyhint="next" :rules="[{ required: true }]" @update:model-value="updateField('title', $event)" />
        
        <template v-if="form.kind === 'login'">
          <van-field class="editor-field editor-field-single" :model-value="form.username || ''" label="账号" autocomplete="off" placeholder="用户名/账号名" enterkeyhint="next" @update:model-value="updateField('username', $event)" />
          
          <van-field
            class="editor-field editor-field-single"
            :model-value="form.password || ''"
            label="密码"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="new-password"
            placeholder="密码"
            enterkeyhint="next"
            @update:model-value="updateField('password', $event)"
          >
            <template #right-icon>
              <div class="editor-password-actions">
                <button
                  class="inline-icon-button"
                  type="button"
                  aria-label="快速生成强密码"
                  title="快速生成强密码"
                  @click.prevent.stop="quickGeneratePassword"
                >
                  <van-icon name="replay" />
                </button>
                <button
                  class="inline-icon-button"
                  type="button"
                  aria-label="自定义生成规则"
                  title="自定义生成规则"
                  @click.prevent.stop="emit('open-generator')"
                >
                  <van-icon name="setting-o" />
                </button>
                <button
                  class="inline-icon-button editor-password-toggle"
                  type="button"
                  :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                  :aria-pressed="showPassword"
                  :title="showPassword ? '隐藏密码' : '显示密码'"
                  @click.prevent.stop="showPassword = !showPassword"
                >
                  <van-icon :name="showPassword ? 'closed-eye' : 'eye-o'" />
                </button>
              </div>
            </template>
          </van-field>

          <van-field class="editor-field editor-field-single" :model-value="form.email || ''" label="邮箱" type="text" inputmode="email" autocomplete="off" placeholder="邮箱地址" enterkeyhint="next" @update:model-value="updateField('email', $event)" />
          <van-field class="editor-field editor-field-single" :model-value="form.phone || ''" label="手机" inputmode="tel" autocomplete="off" placeholder="手机号" enterkeyhint="next" @update:model-value="updateField('phone', $event)" />

          <van-field
            class="editor-field editor-field-area"
            :model-value="domainText"
            label="网站规则"
            type="textarea"
            autocomplete="off"
            :placeholder="form.autofillMatchMode === 'url-prefix' ? 'https://example.com/account' : 'example.com，多行或逗号分隔'"
            @update:model-value="emit('update-domain', String($event))"
          />

          <button
            type="button"
            class="editor-section-toggle"
            :class="{ 'is-expanded': showAdvanced }"
            :aria-expanded="showAdvanced"
            @click="showAdvanced = !showAdvanced"
          >
            <span class="editor-section-toggle-left">
              <van-icon name="setting-o" class="toggle-icon" />
              <span>高级选项与自动填充</span>
            </span>
            <van-icon :name="showAdvanced ? 'arrow-up' : 'arrow-down'" class="toggle-arrow" />
          </button>

          <div v-show="showAdvanced" class="editor-advanced-body">
            <label class="autofill-rule-field">
              <span>匹配方式</span>
              <select
                :value="form.autofillMatchMode || 'base-domain'"
                aria-label="自动填充匹配方式"
                @change="updateField('autofillMatchMode', ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="option in autofillMatchModeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>

            <div class="account-source-field">
              <span>自动填充账号</span>
              <van-radio-group :model-value="form.loginAccountSource" class="account-source-options" direction="horizontal" @update:model-value="updateField('loginAccountSource', $event)">
                <van-radio v-for="option in loginAccountSourceOptions" :key="option.value" :name="option.value">{{ option.label }}</van-radio>
              </van-radio-group>
            </div>

            <van-field class="editor-field editor-field-single" :model-value="form.totpSecret || ''" label="TOTP" autocomplete="off" placeholder="Base32 密钥" @update:model-value="updateField('totpSecret', $event)">
              <template v-if="showQrImagePicker" #button>
                <button
                  type="button"
                  class="inline-icon-button"
                  :disabled="qrImageBusy"
                  aria-label="从图片识别 TOTP 二维码"
                  title="从图片识别 TOTP 二维码"
                  @click.prevent="chooseQrImage"
                ><van-loading v-if="qrImageBusy" size="16" /><van-icon v-else name="photo-o" /></button>
              </template>
            </van-field>
            <input
              v-if="showQrImagePicker"
              ref="qrImageInput"
              hidden
              type="file"
              accept="image/png,image/jpeg,image/webp,image/bmp,.png,.jpg,.jpeg,.webp,.bmp"
              @change="handleQrImageSelected"
            />
            <div v-if="editingId && form.totpSecret" class="totp-box">
              <span>{{ totpCode || '------' }}</span>
              <button class="inline-icon-button" type="button" aria-label="刷新验证码" @click.prevent="emit('refresh-totp')"><van-icon name="replay" /></button>
            </div>

            <van-field class="editor-field editor-field-area" :model-value="form.note || ''" label="备注" type="textarea" autocomplete="off" placeholder="安全问题、登录提示等" @update:model-value="updateField('note', $event)" />
          </div>
        </template>
        <template v-else-if="form.kind !== 'folder'">
          <van-field class="editor-field editor-field-area" :model-value="form.note || ''" label="备注" type="textarea" autocomplete="off" :placeholder="form.kind === 'secure-note' ? '输入需要加密保存的内容' : '补充说明'" @update:model-value="updateField('note', $event)" />
        </template>
        <CustomFieldEditor
          v-if="form.kind !== 'folder'"
          :model-value="form.customFields || []"
          @update:model-value="emit('update-custom-fields', $event)"
        />
      </van-form>
      <div class="editor-submit-bar">
        <van-button block type="primary" native-type="submit" form="entry-editor-form" :loading="busy">保存</van-button>
      </div>
    </div>
  </van-popup>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { showToast } from 'vant'
import CustomFieldEditor from './CustomFieldEditor.vue'
import { entryKindLabel } from '../../services/entryKinds.ts'
import { generatePassword } from '../../services/credentialGenerator.ts'
import type { AutofillMatchMode, EntryKind, LoginAccountSource, VaultCustomField, VaultEntry } from '../../types'

const kindOptions: Array<{ kind: EntryKind; label: string; icon: string }> = [
  { kind: 'login', label: '登录', icon: 'manager-o' },
  { kind: 'secure-note', label: '备忘', icon: 'notes-o' },
  { kind: 'card', label: '银行卡', icon: 'card' },
  { kind: 'identity', label: '身份', icon: 'idcard' },
  { kind: 'api-key', label: '密钥', icon: 'shield-o' },
  { kind: 'folder', label: '分组', icon: 'folder-o' }
]

type EditorField = 'title' | 'username' | 'email' | 'password' | 'phone' | 'autofillMatchMode' | 'loginAccountSource' | 'totpSecret' | 'note'

const props = defineProps<{
  open: boolean
  form: VaultEntry
  domainText: string
  editingId: string
  busy: boolean
  totpCode: string
  autofillMatchModeOptions: Array<{ label: string; value: AutofillMatchMode }>
  loginAccountSourceOptions: Array<{ label: string; value: LoginAccountSource }>
  showQrImagePicker: boolean
  qrImageBusy: boolean
}>()

const showPassword = ref(false)
const showAdvanced = ref(false)
const qrImageInput = ref<HTMLInputElement | null>(null)
let qrImageOrigin: { editingId: string; formId: string } | null = null

function hasAdvancedContent() {
  return Boolean(
    props.form.totpSecret ||
    (props.form.autofillMatchMode && props.form.autofillMatchMode !== 'base-domain') ||
    (props.form.loginAccountSource && props.form.loginAccountSource !== 'username') ||
    (props.form.customFields && props.form.customFields.length > 0) ||
    (props.form.kind === 'login' && props.form.note?.trim())
  )
}

watch([() => props.open, () => props.editingId], () => {
  showPassword.value = false
  qrImageOrigin = null
  showAdvanced.value = hasAdvancedContent()
})

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

function updateField(field: EditorField, value: unknown) {
  emit('update-field', field, String(value ?? ''))
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
