import {
  AliyunOSSAPI,
  APIResponseStatus,
  type APIResponseStatusValue,
  type OSSApiResponse,
  type OSSFileInfo,
  type OssClientSettings
} from '../aliyunOss.ts'
import {
  RemoteVaultStatus,
  type RemoteVaultObjectInfo,
  type RemoteVaultResult,
  type RemoteVaultStatusValue,
  type RemoteVaultStore,
  type RemoteVaultWriteOptions
} from './remoteVaultStore.ts'

type AliyunOssClient = Pick<AliyunOSSAPI, 'downloadFile' | 'uploadFile' | 'getFileInfo' | 'listFiles'>

export class AliyunOssVaultStore implements RemoteVaultStore {
  private readonly client: AliyunOssClient

  constructor(client: AliyunOssClient) {
    this.client = client
  }

  async readObject(objectName: string, maxBytes?: number): Promise<RemoteVaultResult<string>> {
    return mapAliyunTextResult(await this.client.downloadFile(objectName, 'text/plain', maxBytes))
  }

  async writeObject(
    objectName: string,
    content: string,
    contentType = 'application/json',
    options: RemoteVaultWriteOptions = {}
  ): Promise<RemoteVaultResult<string>> {
    const response = options.forbidOverwrite
      ? await this.client.uploadFile(objectName, content, contentType, options)
      : await this.client.uploadFile(objectName, content, contentType)
    return mapAliyunTextResult(response)
  }

  async getObjectInfo(objectName: string): Promise<RemoteVaultResult<RemoteVaultObjectInfo>> {
    const response = await this.client.getFileInfo(objectName)
    return {
      ...mapAliyunMetadata(response),
      content: typeof response.content === 'string'
        ? response.content
        : mapAliyunObjectInfo(response.content)
    }
  }

  async listObjects(prefix = '', limit = 30, cursor = ''): Promise<RemoteVaultResult<RemoteVaultObjectInfo[]>> {
    const response = await this.client.listFiles(prefix, limit, cursor)
    return {
      ...mapAliyunMetadata(response),
      content: typeof response.content === 'string'
        ? response.content
        : response.content.map(mapAliyunObjectInfo)
    }
  }
}

export function createAliyunOssVaultStore(settings: OssClientSettings, signal?: AbortSignal): RemoteVaultStore {
  return new AliyunOssVaultStore(new AliyunOSSAPI(
    settings.bucketName,
    settings.accessKeyId,
    settings.accessKeySecret,
    settings.region,
    signal
  ))
}

function mapAliyunTextResult(response: OSSApiResponse<string | boolean | Blob>): RemoteVaultResult<string> {
  if (typeof response.content !== 'string') {
    return {
      ...mapAliyunMetadata(response),
      status: RemoteVaultStatus.Error,
      content: '远端存储返回了非文本响应'
    }
  }
  return {
    ...mapAliyunMetadata(response),
    content: response.content
  }
}

function mapAliyunMetadata(response: OSSApiResponse<unknown>) {
  return {
    status: mapAliyunStatus(response.status),
    etag: response.etag,
    versionId: response.versionId,
    revision: response.revision,
    nextCursor: response.nextMarker
  }
}

function mapAliyunStatus(status: APIResponseStatusValue): RemoteVaultStatusValue {
  switch (status) {
    case APIResponseStatus.Success:
      return RemoteVaultStatus.Success
    case APIResponseStatus.AuthFail:
      return RemoteVaultStatus.AuthError
    case APIResponseStatus.FileNotExist:
      return RemoteVaultStatus.NotFound
    case APIResponseStatus.Conflict:
      return RemoteVaultStatus.Conflict
    case APIResponseStatus.QuotaExceeded:
      return RemoteVaultStatus.QuotaExceeded
    default:
      return RemoteVaultStatus.Error
  }
}

function mapAliyunObjectInfo(info: OSSFileInfo): RemoteVaultObjectInfo {
  return {
    name: info.name,
    exists: info.exists,
    size: info.size,
    lastModified: info.lastModified,
    etag: info.etag,
    versionId: info.versionId
  }
}
