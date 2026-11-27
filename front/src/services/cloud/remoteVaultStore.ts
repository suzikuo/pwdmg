export const RemoteVaultStatus = {
  Success: 'success',
  Error: 'error',
  AuthError: 'auth-error',
  NotFound: 'not-found',
  Conflict: 'conflict',
  QuotaExceeded: 'quota-exceeded'
} as const

export type RemoteVaultStatusValue = (typeof RemoteVaultStatus)[keyof typeof RemoteVaultStatus]

export interface RemoteVaultResult<T> {
  status: RemoteVaultStatusValue
  content: T | string
  etag?: string
  versionId?: string
  revision?: string
  nextCursor?: string
}

export interface RemoteVaultObjectInfo {
  name: string
  exists: boolean
  size: number
  lastModified: string
  etag?: string
  versionId?: string
}

export interface RemoteVaultStore {
  readonly cacheScope?: string
  readObject(objectName: string, maxBytes?: number): Promise<RemoteVaultResult<string>>
  writeObject(
    objectName: string,
    content: string,
    contentType?: string,
    options?: RemoteVaultWriteOptions
  ): Promise<RemoteVaultResult<string>>
  getObjectInfo(objectName: string): Promise<RemoteVaultResult<RemoteVaultObjectInfo>>
  deleteObject?(objectName: string): Promise<RemoteVaultResult<string>>
  listObjects(prefix?: string, limit?: number, cursor?: string): Promise<RemoteVaultResult<RemoteVaultObjectInfo[]>>
}

export interface RemoteVaultWriteOptions {
  forbidOverwrite?: boolean
}
