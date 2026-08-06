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
      <van-nav-bar safe-area-inset-top :title="editingId ? '编辑条目' : '新建条目'" left-arrow @click-left="emit('update:open', false)" />
      <van-form id="entry-editor-form" class="editor-form" @submit="emit('submit')">
        <van-field class="editor-field editor-field-single" :model-value="form.title" label="名称" placeholder="例如 Github" :rules="[{ required: true }]" @update:model-value="updateField('title', $event)" />
        <van-field v-if="form.kind === 'login'" class="editor-field editor-field-area" :model-value="domainText" label="域名" type="textarea" placeholder="github.com，多行或逗号分隔" @update:model-value="emit('update-domain', String($event))" />
        <template v-if="form.kind === 'login'">
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
      </van-form>
      <div class="editor-submit-bar">
        <van-button block type="primary" native-type="submit" form="entry-editor-form" :loading="busy">保存</van-button>
      </div>
    </div>
  </van-popup>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { LoginAccountSource, VaultEntry } from '../../types'

type EditorField = 'title' | 'username' | 'email' | 'password' | 'phone' | 'loginAccountSource' | 'totpSecret' | 'note'

const props = defineProps<{
  open: boolean
  form: VaultEntry
  domainText: string
  editingId: string
  busy: boolean
  totpCode: string
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
}>()

function updateField(field: EditorField, value: unknown) {
  emit('update-field', field, String(value ?? ''))
}
</script>
