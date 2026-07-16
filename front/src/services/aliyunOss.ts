export const DEFAULT_OSS_OBJECT_NAME = 'mypwdmg-vault.json'

export const APIResponseStatus = {
  Success: 1,
  Fail: 2,
  AuthFail: 3,
  FileNotExist: 4,
  QuotaExceeded: 5
} as const

export const MAX_OSS_OBJECT_BYTES = 16 * 1024 * 1024

export type APIResponseStatusValue = (typeof APIResponseStatus)[keyof typeof APIResponseStatus]

export interface OSSApiResponse<T = string | boolean | Blob> {
  status: APIResponseStatusValue
  content: T
  etag?: string
  versionId?: string
  revision?: string
}

export interface OSSFileInfo {
  name: string
  exists: boolean
  size: number
  lastModified: string
  etag?: string
  versionId?: string
}

export interface OssClientSettings {
  bucketName: string
  accessKeyId: string
  accessKeySecret: string
  region: string
}

export class AliyunOSSAPI {
  bucketName: string
  accessKeyId: string
  accessKeySecret: string
  region: string

  constructor(bucketName: string, accessKeyId: string, accessKeySecret: string, region: string) {
    this.bucketName = bucketName.trim()
    this.accessKeyId = accessKeyId.trim()
    this.accessKeySecret = accessKeySecret
    this.region = region.trim()
  }

  verify() {
    return Boolean(this.bucketName && this.accessKeyId && this.accessKeySecret && this.region)
  }

  getEndpoint() {
    return `https://${this.bucketName}.${this.region}.aliyuncs.com`
  }

  getGMTDate() {
    return new Date().toUTCString()
  }

  async generateSignature(
    method: 'GET' | 'HEAD' | 'PUT',
    contentMD5: string,
    contentType: string,
    date: string,
    ossHeaders: string,
    resource: string
  ) {
    let stringToSign = `${method}\n${contentMD5 || ''}\n${contentType || ''}\n${date || ''}\n`
    if (ossHeaders) stringToSign += `${ossHeaders}\n`
    stringToSign += resource

    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.accessKeySecret),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    )
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(stringToSign))
    return bytesToBase64(new Uint8Array(signature))
  }

  async uploadFile(
    fileName: string,
    fileContent: string,
    mimeType = 'application/json'
  ): Promise<OSSApiResponse> {
    if (!this.verify()) return { status: APIResponseStatus.AuthFail, content: '配置信息不完整' }
    if (new TextEncoder().encode(fileContent).byteLength > MAX_OSS_OBJECT_BYTES) {
      return { status: APIResponseStatus.Fail, content: '云端保险库超过 16 MiB 安全上限' }
    }

    try {
      const objectName = normalizeObjectName(fileName)
      const date = this.getGMTDate()
      const resource = `/${this.bucketName}/${objectName}`
      const ossHeaders = `x-oss-date:${date}`
      const signature = await this.generateSignature('PUT', '', mimeType, date, ossHeaders, resource)
      const headers = {
        'x-oss-date': date,
        'Content-Type': mimeType,
        Authorization: `OSS ${this.accessKeyId}:${signature}`
      }
      const response = await fetch(`${this.getEndpoint()}/${encodeObjectName(objectName)}`, {
        method: 'PUT',
        headers,
        body: fileContent
      })

      if (response.ok) {
        return {
          status: APIResponseStatus.Success,
          content: '上传成功',
          etag: response.headers.get('ETag') || '',
          versionId: response.headers.get('x-oss-version-id') || ''
        }
      }

      const errorText = await response.text()
      if (response.status === 403 && errorText.includes('QuotaExceeded')) {
        return { status: APIResponseStatus.QuotaExceeded, content: '存储空间配额已满' }
      }
      return { status: APIResponseStatus.Fail, content: formatOssHttpError('上传', response.status, errorText) }
    } catch (error) {
      return { status: APIResponseStatus.Fail, content: formatOssError(error) }
    }
  }

  async downloadFile(
    fileName: string,
    fileType = 'text/plain',
    maxBytes = MAX_OSS_OBJECT_BYTES
  ): Promise<OSSApiResponse<string | Blob>> {
    if (!this.verify()) return { status: APIResponseStatus.AuthFail, content: '配置信息不完整' }

    try {
      const objectName = normalizeObjectName(fileName)
      const date = this.getGMTDate()
      const resource = `/${this.bucketName}/${objectName}`
      const ossHeaders = `x-oss-date:${date}`
      const signature = await this.generateSignature('GET', '', '', date, ossHeaders, resource)
      const response = await fetch(`${this.getEndpoint()}/${encodeObjectName(objectName)}`, {
        method: 'GET',
        headers: {
          'x-oss-date': date,
          Authorization: `OSS ${this.accessKeyId}:${signature}`
        }
      })

      if (response.ok) {
        const contentLength = Number(response.headers.get('Content-Length') || 0)
        if (contentLength > maxBytes) throw new Error(`云端文件超过 ${Math.round(maxBytes / 1024 / 1024)} MiB 安全上限`)
        const content = fileType === 'text/plain'
          ? await readTextResponseLimited(response, maxBytes)
          : await readBlobResponseLimited(response, maxBytes)
        return {
          status: APIResponseStatus.Success,
          content,
          etag: response.headers.get('ETag') || '',
          versionId: response.headers.get('x-oss-version-id') || '',
          revision: typeof content === 'string' ? await sha256Text(content) : ''
        }
      }
      if (response.status === 404) return { status: APIResponseStatus.FileNotExist, content: '文件未找到' }

      const errorText = await response.text()
      return { status: APIResponseStatus.Fail, content: formatOssHttpError('下载', response.status, errorText) }
    } catch (error) {
      return { status: APIResponseStatus.Fail, content: formatOssError(error) }
    }
  }

  async checkFileExists(fileName: string): Promise<OSSApiResponse<boolean>> {
    const info = await this.getFileInfo(fileName)
    return {
      status: info.status,
      content: Boolean(info.content && typeof info.content !== 'string' && info.content.exists)
    }
  }

  async getFileInfo(fileName: string): Promise<OSSApiResponse<OSSFileInfo | string>> {
    if (!this.verify()) return { status: APIResponseStatus.AuthFail, content: '配置信息不完整' }

    try {
      const objectName = normalizeObjectName(fileName)
      const date = this.getGMTDate()
      const resource = `/${this.bucketName}/${objectName}`
      const ossHeaders = `x-oss-date:${date}`
      const signature = await this.generateSignature('HEAD', '', '', date, ossHeaders, resource)
      const response = await fetch(`${this.getEndpoint()}/${encodeObjectName(objectName)}`, {
        method: 'HEAD',
        headers: {
          'x-oss-date': date,
          Authorization: `OSS ${this.accessKeyId}:${signature}`
        }
      })

      if (response.ok) {
        return {
          status: APIResponseStatus.Success,
          content: {
            name: objectName,
            exists: true,
            size: Number(response.headers.get('Content-Length') || 0),
            lastModified: response.headers.get('Last-Modified') || '',
            etag: response.headers.get('ETag') || '',
            versionId: response.headers.get('x-oss-version-id') || ''
          }
        }
      }
      if (response.status === 404) {
        return {
          status: APIResponseStatus.FileNotExist,
          content: {
            name: objectName,
            exists: false,
            size: 0,
            lastModified: ''
          }
        }
      }
      const errorText = await response.text().catch(() => '')
      return { status: APIResponseStatus.Fail, content: `检测失败: ${response.status} ${errorText}` }
    } catch (error) {
      return { status: APIResponseStatus.Fail, content: formatOssError(error) }
    }
  }

  async listFiles(prefix = '', maxKeys = 30): Promise<OSSApiResponse<OSSFileInfo[] | string>> {
    if (!this.verify()) return { status: APIResponseStatus.AuthFail, content: '配置信息不完整' }

    try {
      const normalizedPrefix = normalizeObjectName(prefix).replace(/\/?$/, '')
      const query = `prefix=${encodeURIComponent(normalizedPrefix)}&max-keys=${Math.max(1, Math.min(100, Math.round(maxKeys)))}`
      const date = this.getGMTDate()
      const resource = `/${this.bucketName}/`
      const ossHeaders = `x-oss-date:${date}`
      const signature = await this.generateSignature('GET', '', '', date, ossHeaders, resource)
      const response = await fetch(`${this.getEndpoint()}/?${query}`, {
        method: 'GET',
        headers: {
          'x-oss-date': date,
          Authorization: `OSS ${this.accessKeyId}:${signature}`
        }
      })
      if (!response.ok) {
        const errorText = await response.text()
        return { status: APIResponseStatus.Fail, content: `列表失败: ${response.status} ${errorText}` }
      }

      const xmlText = await response.text()
      const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
      const items = [...doc.querySelectorAll('Contents')].map((node) => ({
        name: node.querySelector('Key')?.textContent || '',
        exists: true,
        size: Number(node.querySelector('Size')?.textContent || 0),
        lastModified: node.querySelector('LastModified')?.textContent || ''
      })).filter((item) => item.name)
      return { status: APIResponseStatus.Success, content: items }
    } catch (error) {
      return { status: APIResponseStatus.Fail, content: formatOssError(error) }
    }
  }

  async downloadFileByName(fileName: string, fileType = 'text/plain') {
    return this.downloadFile(fileName, fileType)
  }
}

export function normalizeObjectName(fileName = DEFAULT_OSS_OBJECT_NAME) {
  const trimmed = fileName.trim().replace(/^\/+/, '')
  return trimmed || DEFAULT_OSS_OBJECT_NAME
}

function encodeObjectName(fileName: string) {
  return fileName.split('/').map(encodeURIComponent).join('/')
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function readTextResponseLimited(response: Response, maxBytes: number) {
  const bytes = await readResponseBytesLimited(response, maxBytes)
  return new TextDecoder().decode(bytes)
}

async function readBlobResponseLimited(response: Response, maxBytes: number) {
  const bytes = await readResponseBytesLimited(response, maxBytes)
  return new Blob([bytes], { type: response.headers.get('Content-Type') || 'application/octet-stream' })
}

async function readResponseBytesLimited(response: Response, maxBytes: number) {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) throw new Error('云端文件超过安全上限')
    return bytes
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('云端文件超过安全上限')
    }
    chunks.push(value)
  }

  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function formatOssError(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error || '网络请求失败')
}

function formatOssHttpError(action: string, status: number, errorText: string) {
  const details = parseOssErrorDetails(errorText)
  const code = details.code ? ` ${details.code}` : ''
  const message = details.message ? `: ${details.message}` : ''
  const requestId = details.requestId ? ` (RequestId: ${details.requestId})` : ''
  return `${action}失败: ${status}${code}${message}${requestId}`
}

function parseOssErrorDetails(errorText: string) {
  if (!errorText.trim()) return { code: '', message: '', requestId: '' }
  try {
    const doc = new DOMParser().parseFromString(errorText, 'application/xml')
    if (doc.querySelector('parsererror')) throw new Error('Invalid OSS XML response')
    return {
      code: doc.querySelector('Code')?.textContent?.trim() || '',
      message: doc.querySelector('Message')?.textContent?.trim() || '',
      requestId: doc.querySelector('RequestId')?.textContent?.trim() || ''
    }
  } catch {
    return { code: '', message: errorText.trim().slice(0, 240), requestId: '' }
  }
}
