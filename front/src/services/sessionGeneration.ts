export class SessionGeneration {
  private value = 0

  capture() {
    return this.value
  }

  invalidate() {
    this.value += 1
    return this.value
  }

  isCurrent(captured: number) {
    return Number.isSafeInteger(captured) && captured === this.value
  }

  requireCurrent(captured: number) {
    if (!this.isCurrent(captured)) throw new Error('Vault session changed; vault is locked')
  }
}
