const DB_NAME = 'mypwdmg-web-vault'
const DB_VERSION = 1
const KV_STORE = 'kv'

type KvRecord<T> = {
  key: string
  value: T
}

let dbPromise: Promise<IDBDatabase> | null = null

export async function idbGet<T>(key: string): Promise<T | null> {
  return withStore('readonly', async (store) => {
    const record = await requestToPromise<KvRecord<T> | undefined>(store.get(key))
    return record?.value ?? null
  })
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
  await withStore('readwrite', async (store) => {
    store.put({ key, value })
  })
}

export async function idbSetIfRevision<T>(key: string, value: T, expectedRevision: number): Promise<void> {
  await withStore('readwrite', async (store) => {
    const record = await requestToPromise<KvRecord<unknown> | undefined>(store.get(key))
    const current = record?.value as { revision?: unknown } | null | undefined
    const currentRevision = record
      ? Math.max(1, Math.floor(Number(current?.revision || 1)))
      : 0
    if (currentRevision !== expectedRevision) throw new Error('Vault revision conflict; reload before saving')
    const next = value as { revision?: unknown } | null | undefined
    const nextRevision = Math.max(1, Math.floor(Number(next?.revision || 1)))
    if (nextRevision !== currentRevision + 1) throw new Error('Vault revision must advance by exactly one')
    store.put({ key, value })
  })
}

export async function idbDelete(key: string): Promise<void> {
  await withStore('readwrite', async (store) => {
    store.delete(key)
  })
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await getDb()
  const transaction = db.transaction(KV_STORE, mode)
  const done = transactionDone(transaction)
  const result = await fn(transaction.objectStore(KV_STORE))
  await done
  return result
}

function getDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error('当前 WebView 不支持 IndexedDB'))
        return
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE, { keyPath: 'key' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed'))
    })
  }
  return dbPromise
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'))
  })
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'))
  })
}
