import { SessionGeneration } from '../services/sessionGeneration'

type SessionExpiryHandler = () => void

export function useVaultSession(onExpire: SessionExpiryHandler, timeoutMs: number) {
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
    timer = window.setTimeout(() => {
      timer = 0
      onExpire()
    }, timeoutMs)
  }

  function cancel() {
    if (timer) window.clearTimeout(timer)
    timer = 0
  }

  return { capture, current, isCurrent, invalidate, schedule, cancel }
}
