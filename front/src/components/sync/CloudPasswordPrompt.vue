<template>
  <van-popup
    :show="open"
    round
    class="password-popup"
    :duration="0.14"
    :close-on-click-overlay="false"
    @update:show="emit('update:open', $event)"
    @closed="emit('closed')"
  >
    <div class="password-popup-inner">
      <van-nav-bar safe-area-inset-top :title="title" left-arrow @click-left="emit('cancel')" />
      <van-form class="password-popup-form" @submit="emit('submit')">
        <p class="settings-note compact-note">{{ note }}</p>
        <van-field
          :model-value="password"
          type="password"
          :label="label"
          autocomplete="current-password"
          :placeholder="placeholder"
          @update:model-value="emit('update:password', String($event))"
        />
        <div class="prompt-actions">
          <van-button block plain type="default" native-type="button" @click="emit('cancel')">取消</van-button>
          <van-button block type="primary" native-type="submit" :loading="busy">继续</van-button>
        </div>
      </van-form>
    </div>
  </van-popup>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  open: boolean
  password: string
  title?: string
  note?: string
  label?: string
  placeholder?: string
  busy?: boolean
}>(), {
  title: '校验云端保险库',
  note: '云端文件使用了另一套加密参数。请输入云端保险库的主密码重新校验；云端未设置主密码可留空。',
  label: '云端密码',
  placeholder: '云端未设置可留空',
  busy: false
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:password': [value: string]
  submit: []
  cancel: []
  closed: []
}>()
</script>
