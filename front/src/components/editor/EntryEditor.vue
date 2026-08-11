<template>
  <van-popup
    :show="open"
    position="bottom"
    class="editor-popup"
    :duration="0.12"
    lazy-render
    @update:show="emit('update:open', $event)"
  >
    <div class="sheet-inner" @focusin="emit('focus-field', $event)">
      <van-nav-bar safe-area-inset-top :title="editingId ? `编辑${entryKindLabel(form.kind)}` : `新建${entryKindLabel(form.kind)}`" left-arrow @click-left="emit('update:open', false)" />
      <van-form id="entry-editor-form" class="editor-form" @submit="emit('submit')">
        <van-field class="editor-field editor-field-single" :model-value="form.title" label="名称" placeholder="例如 Github" :rules="[{ required: true }]" @update:model-value="updateField('title', $event)" />
        <van-field
          v-if="form.kind === 'login'"
          class="editor-field editor-field-area"
          :model-value="domainText"
          label="网站规则"
          type="textarea"
          :placeholder="form.autofillMatchMode === 'url-prefix' ? 'https://example.com/account' : 'example.com，多行或逗号分隔'"
          @update:model-value="emit('update-domain', String($event))"
        />
        <template v-if="form.kind === 'login'">
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
          <van-field class="editor-field editor-field-single" :model-value="form.username || ''" label="账号" autocomplete="username" placeholder="用户名/账号名" @update:model-value="updateField('username', $event)" />
          <van-field class="editor-field editor-field-single" :model-value="form.email || ''" label="邮箱" type="email" autocomplete="email" placeholder="邮箱地址" @update:model-value="updateField('email', $event)" />
          <van-field
            class="editor-field editor-field-single"
            :model-value="form.password || ''"
            label="密码"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="current-password"
            placeholder="密码"
            @update:model-value="updateField('password', $event)"
          >
            <template #right-icon>
              <div class="editor-password-actions">
                <button class="inline-icon-button" type="button" aria-label="生成密码" title="生成密码" @click.prevent.stop="emit('open-generator')">
                  <van-icon name="replay" />
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
          <van-field class="editor-field editor-field-single" :model-value="form.phone || ''" label="手机" autocomplete="tel" placeholder="手机号" @update:model-value="updateField('phone', $event)" />
          <div class="account-source-field">
            <span>自动填充账号</span>
            <van-radio-group :model-value="form.loginAccountSource" class="account-source-options" direction="horizontal" @update:model-value="updateField('loginAccountSource', $event)">
              <van-radio v-for="option in loginAccountSourceOptions" :key="option.value" :name="option.value">{{ option.label }}</van-radio>
            </van-radio-group>
          </div>
          <van-field class="editor-field editor-field-single" :model-value="form.totpSecret || ''" label="TOTP" placeholder="Base32 密钥" @update:model-value="updateField('totpSecret', $event)" />
          <van-field class="editor-field editor-field-area" :model-value="form.note || ''" label="备注" type="textarea" placeholder="安全问题、登录提示等" @update:model-value="updateField('note', $event)" />
          <div v-if="editingId && form.totpSecret" class="totp-box">
            <span>{{ totpCode || '------' }}</span>
            <button class="inline-icon-button" type="button" aria-label="刷新验证码" @click.prevent="emit('refresh-totp')"><van-icon name="replay" /></button>
          </div>
        </template>
        <template v-else-if="form.kind !== 'folder'">
          <van-field class="editor-field editor-field-area" :model-value="form.note || ''" label="备注" type="textarea" :placeholder="form.kind === 'secure-note' ? '输入需要加密保存的内容' : '补充说明'" @update:model-value="updateField('note', $event)" />
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
import CustomFieldEditor from './CustomFieldEditor.vue'
import { entryKindLabel } from '../../services/entryKinds.ts'
import type { AutofillMatchMode, LoginAccountSource, VaultCustomField, VaultEntry } from '../../types'

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
}>()

const showPassword = ref(false)

watch([() => props.open, () => props.editingId], () => {
  showPassword.value = false
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update-field': [field: EditorField, value: unknown]
  'update-domain': [value: string]
  submit: []
  'focus-field': [event: FocusEvent]
  'refresh-totp': []
  'open-generator': []
  'update-custom-fields': [value: VaultCustomField[]]
}>()

function updateField(field: EditorField, value: unknown) {
  emit('update-field', field, String(value ?? ''))
}

</script>
