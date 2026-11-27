import { ref } from 'vue'

export const MODAL_STACK_MAX_OFFSET = 90

const activeModalStack = ref<string[]>([])

export function pushModalToStack(id: string): void {
  const key = String(id || '').trim()
  if (!key) return
  const next = activeModalStack.value.filter((item) => item !== key)
  next.push(key)
  activeModalStack.value = next
}

export function removeModalFromStack(id: string): void {
  const key = String(id || '').trim()
  if (!key) return
  if (!activeModalStack.value.includes(key)) return
  activeModalStack.value = activeModalStack.value.filter((item) => item !== key)
}

export function getModalStackOffset(id: string, stacked = false): number {
  const index = activeModalStack.value.indexOf(id)
  const baseOffset = index >= 0 ? index : 0
  const offset = stacked ? Math.max(baseOffset, 1) : baseOffset
  return Math.min(offset, MODAL_STACK_MAX_OFFSET)
}

export function isTopModalInStack(id: string): boolean {
  const stack = activeModalStack.value
  if (stack.length === 0) return true
  return stack[stack.length - 1] === id
}

export function clearModalStack(): void {
  activeModalStack.value = []
}
