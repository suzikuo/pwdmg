<template>
  <UiModal
    :open="open"
    title="凭据生成器"
    subtitle="本地密码学安全随机数生成，不上传任何数据"
    size="md"
    @close="emit('update:open', false)"
  >
    <div class="generator-body">
      <div class="generator-mode-tabs" role="tablist" aria-label="生成类型">
        <button
          v-for="option in modeOptions"
          :key="option.value"
          type="button"
          role="tab"
          class="generator-mode-tab"
          :aria-selected="mode === option.value"
          :class="{ 'is-active': mode === option.value }"
          @click="selectMode(option.value)"
        >
          <UiIcon :name="option.icon" :size="15" />
          <span>{{ option.label }}</span>
        </button>
      </div>

      <div class="generator-output-card" aria-live="polite">
        <div class="generator-output-top">
          <UiBadge :tone="strengthMeta.tone" size="sm">
            {{ strengthMeta.label }}
          </UiBadge>
          <span class="generator-entropy">
            {{ generated.length }} 字符 · 约 {{ Math.round(strength.estimatedEntropyBits) }} bit 熵
          </span>
        </div>

        <div class="generator-output-value">{{ generated }}</div>

        <div class="generator-output-actions">
          <UiButton variant="subtle" size="sm" :disabled="!generated" @click="emit('copy', generated)">
            <UiIcon name="copy" :size="14" />
            <span>复制</span>
          </UiButton>
          <UiButton variant="subtle" size="sm" @click="regenerate">
            <UiIcon name="refresh" :size="14" />
            <span>换一个</span>
          </UiButton>
        </div>
      </div>

      <p v-if="error" class="generator-error" role="alert">{{ error }}</p>

      <div v-if="mode === 'password'" class="generator-controls">
        <div class="generator-slider-card">
          <div class="generator-slider-head">
            <span class="generator-control-label">密码长度</span>
            <div class="generator-stepper">
              <button
                type="button"
                class="generator-step-btn"
                :disabled="passwordLength <= 8"
                aria-label="减少长度"
                @click="stepPasswordLength(-1)"
              >
                -
              </button>
              <strong class="generator-length-value">{{ passwordLength }}</strong>
              <button
                type="button"
                class="generator-step-btn"
                :disabled="passwordLength >= 128"
                aria-label="增加长度"
                @click="stepPasswordLength(1)"
              >
                +
              </button>
            </div>
          </div>
          <input
            v-model.number="passwordLength"
            class="generator-range"
            type="range"
            min="8"
            max="64"
            step="1"
            aria-label="密码长度滑块"
            @input="regenerate"
          />
          <div class="generator-range-ticks">
            <span>8</span>
            <span>20</span>
            <span>32</span>
            <span>64</span>
          </div>
        </div>

        <div class="generator-sets-grid" role="group" aria-label="字符集">
          <label
            v-for="item in charsetOptions"
            :key="item.value"
            class="generator-set-chip"
            :class="{ 'is-checked': passwordSets.includes(item.value) }"
          >
            <input
              type="checkbox"
              :value="item.value"
              :checked="passwordSets.includes(item.value)"
              @change="toggleCharset(item.value)"
            />
            <span class="generator-set-name">{{ item.label }}</span>
            <code class="generator-set-sample">{{ item.sample }}</code>
          </label>
        </div>

        <div class="generator-switch-row">
          <div class="generator-switch-copy">
            <strong>排除易混淆字符</strong>
            <span>避免出现 I、l、1、O、0 等容易看错的字符</span>
          </div>
          <UiSwitch
            v-model="excludeAmbiguous"
            aria-label="排除易混淆字符"
            @change="regenerate"
          />
        </div>
      </div>

      <div v-else class="generator-controls">
        <div class="generator-slider-card">
          <div class="generator-slider-head">
            <span class="generator-control-label">词组数量</span>
            <div class="generator-stepper">
              <button
                type="button"
                class="generator-step-btn"
                :disabled="wordCount <= 3"
                aria-label="减少词组"
                @click="stepWordCount(-1)"
              >
                -
              </button>
              <strong class="generator-length-value">{{ wordCount }} 组</strong>
              <button
                type="button"
                class="generator-step-btn"
                :disabled="wordCount >= 10"
                aria-label="增加词组"
                @click="stepWordCount(1)"
              >
                +
              </button>
            </div>
          </div>
          <input
            v-model.number="wordCount"
            class="generator-range"
            type="range"
            min="3"
            max="10"
            step="1"
            aria-label="词组数量滑块"
            @input="regenerate"
          />
          <div class="generator-range-ticks">
            <span>3</span>
            <span>5</span>
            <span>7</span>
            <span>10</span>
          </div>
        </div>

        <UiInput
          :model-value="separator"
          label="分隔符"
          placeholder="-"
          monospace
          @update:model-value="updateSeparator"
        />

        <div class="generator-switch-row">
          <div class="generator-switch-copy">
            <strong>首字母大写</strong>
            <span>让每个词组的首字母大写，便于阅读</span>
          </div>
          <UiSwitch v-model="capitalizeWords" aria-label="首字母大写" @change="regenerate" />
        </div>

        <div class="generator-switch-row">
          <div class="generator-switch-copy">
            <strong>附加随机数字</strong>
            <span>在口令末尾附加两位随机数字提升强度</span>
          </div>
          <UiSwitch v-model="includeNumber" aria-label="添加随机数字" @change="regenerate" />
        </div>
      </div>

      <div v-if="history.length > 1" class="generator-history">
        <div class="generator-history-head">
          <strong>本次生成记录</strong>
          <button type="button" class="generator-history-clear" @click="history = []">清空</button>
        </div>
        <div class="generator-history-list">
          <button
            v-for="item in history"
            :key="item.id"
            type="button"
            class="generator-history-item"
            :class="{ 'is-current': item.value === generated }"
            @click="generated = item.value"
          >
            <span class="generator-history-value">{{ item.value }}</span>
            <UiBadge tone="neutral" size="sm">{{ item.label }}</UiBadge>
          </button>
        </div>
      </div>
    </div>

    <template #footer>
      <UiButton variant="secondary" :disabled="!generated" @click="emit('copy', generated)">
        <UiIcon name="copy" :size="15" />
        <span>复制凭据</span>
      </UiButton>
      <UiButton v-if="canApply" variant="primary" :disabled="!generated" @click="emit('apply', generated)">
        <UiIcon name="check" :size="15" />
        <span>填入编辑器</span>
      </UiButton>
      <UiButton v-else variant="primary" @click="regenerate">
        <UiIcon name="refresh" :size="15" />
        <span>重新生成</span>
      </UiButton>
    </template>
  </UiModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { UiBadge, UiButton, UiIcon, UiInput, UiModal, UiSwitch, type UiIconName } from '../ui'
import {
  generatePassphrase,
  generatePassword,
  type GeneratorMode
} from '../../services/credentialGenerator.ts'
import { estimatePasswordStrength } from '../../services/passwordHealth.ts'

const props = withDefaults(
  defineProps<{
    open: boolean
    allowApply?: boolean
    applyMode?: boolean
    resetKey: number
  }>(),
  {
    allowApply: false,
    applyMode: false
  }
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  copy: [value: string]
  apply: [value: string]
}>()

const modeOptions: Array<{ value: GeneratorMode; label: string; icon: UiIconName }> = [
  { value: 'password', label: '强密码', icon: 'key' },
  { value: 'passphrase', label: '易记口令', icon: 'wand' }
]

const charsetOptions = [
  { value: 'uppercase', label: '大写字母', sample: 'A-Z' },
  { value: 'lowercase', label: '小写字母', sample: 'a-z' },
  { value: 'digits', label: '数字', sample: '0-9' },
  { value: 'symbols', label: '符号', sample: '!@#' }
]

const mode = ref<GeneratorMode>('password')
const generated = ref('')
const error = ref('')
const history = ref<Array<{ id: number; value: string; label: string }>>([])
const historySequence = ref(0)
const passwordLength = ref(20)
const passwordSets = ref<string[]>(['uppercase', 'lowercase', 'digits', 'symbols'])
const excludeAmbiguous = ref(true)
const wordCount = ref(5)
const separator = ref('-')
const capitalizeWords = ref(true)
const includeNumber = ref(true)

const canApply = computed(() => Boolean(props.allowApply || props.applyMode))
const strength = computed(() => estimatePasswordStrength(generated.value))

const strengthMeta = computed<{ label: string; tone: 'success' | 'brand' | 'warning' | 'danger' }>(() => {
  const score = strength.value.score
  if (score >= 4) return { label: '极强', tone: 'success' }
  if (score === 3) return { label: '强', tone: 'brand' }
  if (score === 2) return { label: '中等', tone: 'warning' }
  return { label: '较弱', tone: 'danger' }
})

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !generated.value) regenerate()
  },
  { immediate: true }
)

watch(
  () => props.resetKey,
  () => {
    generated.value = ''
    error.value = ''
    history.value = []
    if (props.open) regenerate()
  }
)

function selectMode(value: GeneratorMode) {
  mode.value = value
  regenerate()
}

function stepPasswordLength(delta: number) {
  passwordLength.value = Math.min(128, Math.max(8, passwordLength.value + delta))
  regenerate()
}

function stepWordCount(delta: number) {
  wordCount.value = Math.min(10, Math.max(3, wordCount.value + delta))
  regenerate()
}

function toggleCharset(name: string) {
  const next = new Set(passwordSets.value)
  if (next.has(name)) {
    if (next.size <= 1) return
    next.delete(name)
  } else {
    next.add(name)
  }
  passwordSets.value = [...next]
  regenerate()
}

function updateSeparator(value: string) {
  separator.value = value.slice(0, 3)
  regenerate()
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
    } else {
      value = generatePassphrase({
        words: wordCount.value,
        separator: separator.value,
        capitalize: capitalizeWords.value,
        includeNumber: includeNumber.value
      })
    }
    generated.value = value
    historySequence.value += 1
    history.value = [
      { id: historySequence.value, value, label: modeOptions.find((item) => item.value === mode.value)?.label || '' },
      ...history.value.filter((item) => item.value !== value)
    ].slice(0, 4)
  } catch (reason) {
    generated.value = ''
    error.value = reason instanceof Error ? reason.message : '生成失败'
  }
}
</script>

<style scoped>
.generator-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.generator-mode-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border-radius: var(--radius-md);
  background-color: var(--surface-container);
}

.generator-mode-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: var(--control-height-sm);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--app-font-sm);
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard);
}

.generator-mode-tab.is-active {
  background-color: var(--panel-bg);
  color: var(--brand);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.generator-output-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--brand) 28%, var(--border-soft));
  border-radius: var(--radius-md);
  background-color: var(--surface-container-low);
}

.generator-output-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.generator-entropy {
  font-size: var(--app-font-xs);
  color: var(--text-muted);
}

.generator-output-value {
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background-color: var(--panel-bg);
  border: 1px solid var(--border-soft);
  font-family: var(--font-mono);
  font-size: var(--app-font-lg);
  font-weight: 600;
  line-height: 1.5;
  letter-spacing: 0.03em;
  color: var(--text-main);
  overflow-wrap: anywhere;
  user-select: all;
}

.generator-output-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.generator-error {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background-color: var(--danger-soft);
  color: var(--danger);
  font-size: var(--app-font-sm);
}

.generator-controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.generator-slider-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background-color: var(--surface-container-low);
  border: 1px solid var(--border-soft);
}

.generator-slider-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.generator-control-label {
  font-size: var(--app-font-sm);
  font-weight: 600;
  color: var(--text-main);
}

.generator-stepper {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.generator-step-btn {
  width: 26px;
  height: 26px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background-color: var(--panel-bg);
  color: var(--text-main);
  font-size: var(--app-font-md);
  line-height: 1;
  cursor: pointer;
}

.generator-step-btn:hover:not(:disabled) {
  border-color: var(--brand);
  color: var(--brand);
}

.generator-step-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.generator-length-value {
  min-width: 34px;
  text-align: center;
  font-family: var(--font-mono);
  font-size: var(--app-font-base);
  color: var(--brand);
}

.generator-range {
  width: 100%;
  accent-color: var(--brand);
  cursor: pointer;
}

.generator-range-ticks {
  display: flex;
  justify-content: space-between;
  font-size: var(--app-font-xs);
  color: var(--text-muted);
}

.generator-sets-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.generator-set-chip {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background-color: var(--surface-container-low);
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.generator-set-chip input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.generator-set-chip.is-checked {
  background-color: var(--brand-soft);
  border-color: var(--brand);
  color: var(--text-main);
}

.generator-set-name {
  font-size: var(--app-font-sm);
  font-weight: 500;
}

.generator-set-sample {
  font-family: var(--font-mono);
  font-size: var(--app-font-xs);
  color: var(--text-muted);
}

.generator-set-chip.is-checked .generator-set-sample {
  color: var(--brand);
}

.generator-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 14px;
  border-radius: var(--radius-md);
  background-color: var(--surface-container-low);
  border: 1px solid var(--border-soft);
}

.generator-switch-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.generator-switch-copy strong {
  font-size: var(--app-font-sm);
  font-weight: 600;
  color: var(--text-main);
}

.generator-switch-copy span {
  font-size: var(--app-font-xs);
  color: var(--text-muted);
  line-height: 1.35;
}

.generator-history {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--border-soft);
}

.generator-history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--app-font-xs);
  color: var(--text-secondary);
}

.generator-history-clear {
  border: 0;
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-muted);
  font-size: var(--app-font-xs);
  cursor: pointer;
}

.generator-history-clear:hover {
  background-color: var(--surface-container-high);
  color: var(--text-main);
}

.generator-history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.generator-history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background-color: var(--surface-container-low);
  text-align: left;
  cursor: pointer;
}

.generator-history-item:hover {
  border-color: var(--border-strong);
}

.generator-history-item.is-current {
  border-color: var(--brand);
  background-color: var(--brand-soft);
}

.generator-history-value {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: var(--app-font-xs);
  color: var(--text-main);
}
</style>
