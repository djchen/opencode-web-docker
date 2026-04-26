export class MockStorage implements Storage {
  store = new Map<string, string>()
  readonly setCalls: Array<{ key: string; value: string }> = []
  readonly removeCalls: string[] = []

  get length(): number {
    return this.store.size
  }
  clear(): void {
    this.store.clear()
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }
  setItem(key: string, value: string): void {
    this.setCalls.push({ key, value })
    this.store.set(key, value)
  }
  removeItem(key: string): void {
    this.removeCalls.push(key)
    this.store.delete(key)
  }
}
