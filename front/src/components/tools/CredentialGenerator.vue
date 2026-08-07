<template>
  <van-popup
    :show="open"
    position="bottom"
    round
    class="credential-generator-popup"
    :duration="0.14"
    lazy-render
    @update:show="emit('update:open', $event)"
  >
    <section class="credential-generator-shell">
      <van-nav-bar safe-area-inset-top title="凭据生成器" left-arrow @click-left="emit('update:open', false)" />

      <div class="generator-mode-tabs" role="tablist" aria-label="生成类型">
        <button
          v-for="option in modeOptions"
          :key="option.value"
          type="button"
          role="tab"
          :aria-selected="mode === option.value"
          :class="{ active: mode === option.value }"
          @click="selectMode(option.value)"
        >
          <van-icon :name="option.icon" />
          <span>{{ option.label }}</span>
        </button>
      </div>

      <div class="generator-scroll-area">
        <div class="generator-output" aria-live="polite">
          <span>{{ generated || '等待生成' }}</span>
          <button type="button" class="inline-icon-button" aria-label="重新生成" title="重新生成" @click="regenerate">
            <van-icon name="replay" />
          </button>
        </div>
        <p v-if="error" class="generator-error" role="alert">{{ error }}</p>

        <div v-if="mode === 'password'" class="generator-controls">
          <van-cell title="长度" :label="`${passwordLength} 个字符`">
            <template #right-icon>
              <van-stepper v-model="passwordLength" :min="8" :max="128" integer button-size="24px" @change="regenerate" />
            </template>
          </van-cell>
          <van-checkbox-group v-model="passwordSets" class="generator-check-grid" @change="regenerate">
            <van-checkbox name="uppercase">大写字母</van-checkbox>
            <van-checkbox name="lowercase">小写字母</van-checkbox>
            <van-checkbox name="digits">数字</van-checkbox>
            <van-checkbox name="symbols">符号</van-checkbox>
          </van-checkbox-group>
          <van-cell center title="排除易混淆字符" label="例如 I、l、1、O、0">
            <template #right-icon><van-switch v-model="excludeAmbiguous" size="22px" @change="regenerate" /></template>
          </van-cell>
        </div>

        <div v-else-if="mode === 'passphrase'" class="generator-controls">
          <van-cell title="词组数量" :label="`${wordCount} 组可读词`">
            <template #right-icon>
              <van-stepper v-model="wordCount" :min="3" :max="10" integer button-size="24px" @change="regenerate" />
            </template>
          </van-cell>
          <van-field v-model="separator" label="分隔符" maxlength="3" placeholder="-" @change="regenerate" />
          <van-cell center title="首字母大写">
            <template #right-icon><van-switch v-model="capitalizeWords" size="22px" @change="regenerate" /></template>
          </van-cell>
          <van-cell center title="添加随机数字">
            <template #right-icon><van-switch v-model="includeNumber" size="22px" @change="regenerate" /></template>
          </van-cell>
        </div>

        <div v-else class="generator-controls">
          <div class="generator-submode">
            <button type="button" :class="{ active: usernameMode === 'random' }" @click="setUsernameMode('random')">随机用户名</button>
            <button type="button" :class="{ active: usernameMode === 'plus-address' }" @click="setUsernameMode('plus-address')">加号邮箱</button>
          </div>
          <van-field
            v-if="usernameMode === 'plus-address'"
            v-model="baseEmail"
            type="email"
            label="基础邮箱"
            placeholder="name@example.com"
            autocomplete="email"
          />
          <van-cell title="数字长度" :label="`${usernameDigits} 位`">
            <template #right-icon>
              <van-stepper v-model="usernameDigits" :min="2" :max="8" integer button-size="24px" @change="regenerate" />
            </template>
          </van-cell>
        </div>

        <div v-if="history.length" class="generator-history">
          <div class="generator-section-head"><strong>本次记录</strong><button type="button" @click="history = []">清空</button></div>
          <button v-for="item in history" :key="item.id" type="button" @click="generated = item.value">
            <span>{{ item.value }}</span><small>{{ item.label }}</small>
          </button>
        </div>
      </div>

      <div class="generator-actions">
        <van-button plain type="primary" icon="description-o" :disabled="!generated" @click="emit('copy', generated)">复制</van-button>
        <van-button v-if="allowApply" type="primary" icon="success" :disabled="!generated" @click="emit('apply', generated)">用于当前条目</van-button>
        <van-button v-else type="primary" icon="replay" @click="regenerate">重新生成</van-button>
      </div>
    </section>
  </van-popup>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  generatePassphrase,
  generatePassword,
  generateUsername,
  type GeneratorMode,
  type UsernameMode
} from '../../services/credentialGenerator.ts'

const props = defineProps<{
  open: boolean
  allowApply: boolean
  resetKey: number
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  copy: [value: string]
  apply: [value: string]
}>()

const modeOptions: Array<{ value: GeneratorMode; label: string; icon: string }> = [
  { value: 'password', label: '密码', icon: 'closed-eye' },
  { value: 'passphrase', label: '口令', icon: 'records-o' },
  { value: 'username', label: '用户名', icon: 'contact-o' }
]
const mode = ref<GeneratorMode>('password')
const generated = ref('')
const error = ref('')
const history = ref<Array<{ id: number; value: string; label: string }>>([])
const historySequence = ref(0)
const passwordLength = ref(20)
const passwordSets = ref(['uppercase', 'lowercase', 'digits', 'symbols'])
const excludeAmbiguous = ref(true)
const wordCount = ref(5)
const separator = ref('-')
const capitalizeWords = ref(true)
const includeNumber = ref(true)
const usernameMode = ref<UsernameMode>('random')
const baseEmail = ref('')
const usernameDigits = ref(4)

watch(() => props.open, (open) => {
  if (open && !generated.value) regenerate()
})

watch(() => props.resetKey, () => {
  generated.value = ''
  error.value = ''
  history.value = []
  baseEmail.value = ''
})

function selectMode(value: GeneratorMode) {
  mode.value = value
  regenerate()
}

function setUsernameMode(value: UsernameMode) {
  usernameMode.value = value
  if (value === 'random' || baseEmail.value.trim()) regenerate()
  else generated.value = ''
}

function regenerate() {
  error.value = ''
  try {
    let value = ''
    if (mode.value === 'password') {
      const selected = new Set(passwordSets.value)
      value = generatePassword({
        length: passwordLength.value,
        uppercase: selected.has('uppercase'),
        lowercase: selected.has('lowercase'),
        digits: selected.has('digits'),
        symbols: selected.has('symbols'),
        excludeAmbiguous: excludeAmbiguous.value
      })
    } else if (mode.value === 'passphrase') {
      value = generatePassphrase({
        words: wordCount.value,
        separator: separator.value,
        capitalize: capitalizeWords.value,
        includeNumber: includeNumber.value
      })
    } else {
      value = generateUsername({
        mode: usernameMode.value,
        email: baseEmail.value,
        digits: usernameDigits.value
      })
    }
    generated.value = value
    historySequence.value += 1
    history.value = [
      { id: historySequence.value, value, label: modeOptions.find((item) => item.value === mode.value)?.label || '' },
      ...history.value.filter((item) => item.value !== value)
    ].slice(0, 6)
  } catch (reason) {
    generated.value = ''
    error.value = reason instanceof Error ? reason.message : '生成失败'
  }
}
</script>

<style scoped>
.credential-generator-shell {
  width: min(100vw, 640px);
  max-height: 88vh;
  max-height: 88dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--text-main);
  background: var(--panel-bg);
}

.generator-mode-tabs,
.generator-submode {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  margin: 10px 12px 0;
  padding: 3px;
  border-radius: 8px;
  background: var(--panel-bg-muted);
}

.generator-mode-tabs button,
.generator-submode button {
  min-width: 0;
  min-height: 38px;
  border: 0;
  border-radius: 6px;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
}

.generator-mode-tabs button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.generator-mode-tabs button.active,
.generator-submode button.active {
  color: var(--brand-strong);
  background: var(--panel-bg);
  box-shadow: 0 1px 4px color-mix(in srgb, var(--text-main), transparent 90%);
}

.generator-scroll-area {
  min-height: 0;
  display: grid;
  gap: 12px;
  padding: 12px;
  overflow-y: auto;
}

.generator-output {
  min-height: 64px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 36px;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  background: var(--panel-bg-muted);
}

.generator-output > span {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text-main);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--app-font-md);
  line-height: 1.5;
}

.generator-error {
  margin: -4px 2px 0;
  color: var(--danger);
  font-size: var(--app-font-sm);
}

.generator-controls {
  display: grid;
  gap: 8px;
}

.generator-controls .van-cell,
.generator-controls .van-field {
  border-radius: 8px;
  background: var(--panel-bg-muted);
}

.generator-check-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 12px;
  border-radius: 8px;
  background: var(--panel-bg-muted);
}

.generator-submode {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0;
}

.generator-history {
  display: grid;
  gap: 1px;
  overflow: hidden;
  border-radius: 8px;
  background: var(--border-soft);
}

.generator-section-head,
.generator-history > button {
  min-width: 0;
  padding: 9px 11px;
  border: 0;
  background: var(--panel-bg-muted);
}

.generator-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.generator-section-head button {
  border: 0;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
}

.generator-history > button {
  display: grid;
  gap: 2px;
  text-align: left;
  cursor: pointer;
}

.generator-history span,
.generator-history small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.generator-history span {
  color: var(--text-main);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.generator-history small {
  color: var(--text-muted);
}

.generator-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 10px 12px max(10px, env(safe-area-inset-bottom));
  border-top: 1px solid var(--border-soft);
  background: var(--panel-bg);
}

@media (max-width: 420px) {
  .credential-generator-shell {
    width: 100vw;
    max-height: 92vh;
    max-height: 92dvh;
  }

  .generator-mode-tabs button {
    display: grid;
    place-items: center;
    gap: 2px;
    font-size: var(--app-font-sm);
  }
}
</style>
