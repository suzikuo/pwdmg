import { SessionGeneration } from '../services/sessionGeneration.ts'

type SessionExpiryHandler = () => void
type SessionTimeout = number | (() => number)

export function useVaultSession(onExpire: SessionExpiryHandler, timeoutMs: SessionTimeout) {
  const generation = new SessionGeneration()
  let timer = 0

  function capture() {
    return generation.capture()
  }

  function current() {
    return generation.capture()
  }

  function isCurrent(value: number) {
    return generation.isCurrent(value)
  }

  function invalidate() {
    return generation.invalidate()
  }

  function schedule(unlocked: boolean) {
    cancel()
    if (!unlocked) return
    const delay = typeof timeoutMs === 'function' ? timeoutMs() : timeoutMs
    if (!Number.isFinite(Number(delay)) || Number(delay) <= 0) return
    timer = window.setTimeout(() => {
      timer = 0
      onExpire()
    }, Number(delay))
  }

  function cancel() {
    if (timer) window.clearTimeout(timer)
    timer = 0
  }

  return { capture, current, isCurrent, invalidate, schedule, cancel }
}
