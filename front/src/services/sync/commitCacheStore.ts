import type { CommitCache, RemoteCommit } from './appendOnlyRemoteVault.ts'

export const COMMIT_CACHE_DATABASE_NAME = 'mypwdmg-sync-commit-cache-v1'
export const COMMIT_CACHE_STORE_NAME = 'commits'
export const DEFAULT_MAX_COMMIT_CACHE_ENTRIES = 2_000

const COMMIT_CACHE_DATABASE_VERSION = 1
const CACHED_AT_INDEX_NAME = 'cachedAt'

type StoredCommitRecord = {
  key: string
  commit: RemoteCommit
  cachedAt: number
}

export type PersistentCommitCacheOptions = {
  maxEntries?: number
  databaseName?: string
  indexedDB?: IDBFactory | null
}

export function createPersistentCommitCache(options: PersistentCommitCacheOptions = {}): CommitCache {
  const capacity = Math.max(1, Math.floor(options.maxEntries ?? DEFAULT_MAX_COMMIT_CACHE_ENTRIES))
  const databaseName = options.databaseName || COMMIT_CACHE_DATABASE_NAME
  const hasExplicitIdb = Object.prototype.hasOwnProperty.call(options, 'indexedDB')
  const l1 = new Map<string, RemoteCommit>()

  let dbPromise: Promise<IDBDatabase | null> | null = null
  let activeIdbFactory: IDBFactory | null = null

  function putL1(key: string, commit: RemoteCommit): void {
    if (l1.has(key)) l1.delete(key)
    l1.set(key, commit)
    while (l1.size > capacity) {
      const oldestKey = l1.keys().next().value
      if (oldestKey === undefined) break
      l1.delete(oldestKey)
    }
  }

  function resolveIdbFactory(): IDBFactory | null {
    if (hasExplicitIdb) return options.indexedDB ?? null
    return typeof globalThis.indexedDB !== 'undefined' && globalThis.indexedDB ? globalThis.indexedDB : null
  }

  function getDatabase(): Promise<IDBDatabase | null> {
    const idb = resolveIdbFactory()
    if (!idb) return Promise.resolve(null)
    if (dbPromise && activeIdbFactory === idb) return dbPromise
    activeIdbFactory = idb
    dbPromise = openCommitCacheDatabase(idb, databaseName)
      .then((db) => {
        db.onclose = () => {
          if (activeIdbFactory === idb) dbPromise = null
        }
        db.onversionchange = () => {
          db.close()
          if (activeIdbFactory === idb) dbPromise = null
        }
        return db
      })
      .catch(() => {
        if (activeIdbFactory === idb) dbPromise = null
        return null
      })
    return dbPromise
  }

  return {
    async get(key: string): Promise<RemoteCommit | undefined> {
      const hit = l1.get(key)
      if (hit) {
        l1.delete(key)
        l1.set(key, hit)
        return hit
      }
      const db = await getDatabase()
      if (!db) return undefined
      try {
        const transaction = db.transaction(COMMIT_CACHE_STORE_NAME, 'readonly')
        const record = await requestResult<StoredCommitRecord | undefined>(
          transaction.objectStore(COMMIT_CACHE_STORE_NAME).get(key)
        )
        if (!record || typeof record !== 'object' || !record.commit) return undefined
        putL1(key, record.commit)
        return record.commit
      } catch {
        return undefined
      }
    },

    async set(key: string, commit: RemoteCommit): Promise<void> {
      putL1(key, commit)
      const db = await getDatabase()
      if (!db) return
      try {
        const transaction = db.transaction(COMMIT_CACHE_STORE_NAME, 'readwrite')
        const done = transactionDone(transaction)
        const store = transaction.objectStore(COMMIT_CACHE_STORE_NAME)
        store.put({
          key,
          commit,
          cachedAt: Date.now()
        } satisfies StoredCommitRecord)
        const count = await requestResult<number>(store.count())
        if (count > capacity) {
          await pruneOldestEntries(store, count - capacity)
        }
        await done
      } catch {
        // IndexedDB persistence failures must never block sync reads or writes.
      }
    }
  }
}

function openCommitCacheDatabase(idb: IDBFactory, databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = idb.open(databaseName, COMMIT_CACHE_DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      const store = database.objectStoreNames.contains(COMMIT_CACHE_STORE_NAME)
        ? request.transaction?.objectStore(COMMIT_CACHE_STORE_NAME)
        : database.createObjectStore(COMMIT_CACHE_STORE_NAME, { keyPath: 'key' })
      if (store && !store.indexNames.contains(CACHED_AT_INDEX_NAME)) {
        store.createIndex(CACHED_AT_INDEX_NAME, 'cachedAt', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Could not open commit cache database'))
    request.onblocked = () => reject(new Error('Commit cache database upgrade is blocked'))
  })
}

function pruneOldestEntries(store: IDBObjectStore, deleteCount: number): Promise<void> {
  if (deleteCount <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const source: IDBObjectStore | IDBIndex = store.indexNames.contains(CACHED_AT_INDEX_NAME)
      ? store.index(CACHED_AT_INDEX_NAME)
      : store
    const request = source.openCursor()
    let remaining = deleteCount
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor || remaining <= 0) {
        resolve()
        return
      }
      remaining -= 1
      cursor.delete()
      cursor.continue()
    }
    request.onerror = () => reject(request.error || new Error('Failed to prune commit cache'))
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Commit cache request failed'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('Commit cache transaction failed'))
    transaction.onabort = () => reject(transaction.error || new Error('Commit cache transaction aborted'))
  })
}
