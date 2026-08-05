export class AutoSyncPasswordGate {
  private readonly blockedKeys = new Set<string>()

  isBlocked(...scopeKeys: string[]) {
    return this.keys(scopeKeys).some((scopeKey) => this.blockedKeys.has(scopeKey))
  }

  block(...scopeKeys: string[]) {
    const keys = this.keys(scopeKeys)
    const newlyBlocked = keys.length > 0 && !keys.some((scopeKey) => this.blockedKeys.has(scopeKey))
    for (const scopeKey of keys) this.blockedKeys.add(scopeKey)
    return newlyBlocked
  }

  clear(...scopeKeys: string[]) {
    for (const scopeKey of this.keys(scopeKeys)) this.blockedKeys.delete(scopeKey)
  }

  clearAll() {
    this.blockedKeys.clear()
  }

  private keys(scopeKeys: string[]) {
    return [...new Set(scopeKeys.map((value) => String(value || '').trim()).filter(Boolean))]
  }
}
