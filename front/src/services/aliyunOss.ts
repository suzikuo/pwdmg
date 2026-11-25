import { bytesToBase64, sha256Hex } from './shared/encoding.ts'

export const DEFAULT_OSS_OBJECT_NAME = 'pwd/mypwdmg-vault.json'

export const APIResponseStatus = {
  Success: 1,
  Fail: 2,
  AuthFail: 3,
  FileNotExist: 4,
  QuotaExceeded: 5,
  Conflict: 6
} as const

export const MAX_OSS_OBJECT_BYTES = 16 * 1024 * 1024
const OSS_REQUEST_TIMEOUT_MS = 30_000

export type APIResponseStatusValue = (typeof APIResponseStatus)[keyof typeof APIResponseStatus]

export interface OSSApiResponse<T = string | boolean | Blob> {
  status: APIResponseStatusValue
  content: T
  etag?: string
  versionId?: string
  revision?: string
  nextMarker?: string
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

export interface OssWriteOptions {
  forbidOverwrite?: boolean
}

export class AliyunOSSAPI {
  bucketName: string
  accessKeyId: string
  accessKeySecret: string
  region: string
  signal?: AbortSignal

  constructor(bucketName: string, accessKeyId: string, accessKeySecret: string, region: string, signal?: AbortSignal) {
    this.bucketName = bucketName.trim()
    this.accessKeyId = accessKeyId.trim()
    this.accessKeySecret = accessKeySecret
    this.region = region.trim()
    this.signal = signal
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

  private async request(input: RequestInfo | URL, init: RequestInit = {}) {
    const signal = this.signal
    const controller = new AbortController()
    const abortFromParent = () => controller.abort(signal?.reason)
    if (signal?.aborted) abortFromParent()
    else signal?.addEventListener('abort', abortFromParent, { once: true })
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = globalThis.setTimeout(() => {
        const error = new Error('云端请求超时（30 秒）')
        reject(error)
        controller.abort(error)
      }, OSS_REQUEST_TIMEOUT_MS)
    })
    try {
      return await Promise.race([fetch(input, { ...init, signal: controller.signal }), timeout])
    } finally {
      globalThis.clearTimeout(timeoutId)
      signal?.removeEventListener('abort', abortFromParent)
    }
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
    mimeType = 'application/json',
    options: OssWriteOptions = {}
  ): Promise<OSSApiResponse> {
    if (!this.verify()) return { status: APIResponseStatus.AuthFail, content: '配置信息不完整' }
    if (new TextEncoder().encode(fileContent).byteLength > MAX_OSS_OBJECT_BYTES) {
      return { status: APIResponseStatus.Fail, content: '云端保险库超过 16 MiB 安全上限' }
    }

    try {
      const objectName = normalizeObjectName(fileName)
      const date = this.getGMTDate()
      const resource = `/${this.bucketName}/${objectName}`
      const ossHeaders = [
        `x-oss-date:${date}`,
        ...(options.forbidOverwrite ? ['x-oss-forbid-overwrite:true'] : [])
      ].join('\n')
      const signature = await this.generateSignature('PUT', '', mimeType, date, ossHeaders, resource)
      const headers = {
        'x-oss-date': date,
        'Content-Type': mimeType,
        Authorization: `OSS ${this.accessKeyId}:${signature}`,
        ...(options.forbidOverwrite ? { 'x-oss-forbid-overwrite': 'true' } : {})
      }
      const response = await this.request(`${this.getEndpoint()}/${encodeObjectName(objectName)}`, {
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

      const errorText = await readTextResponseLimited(response, 64 * 1024)
      if (response.status === 403 && errorText.includes('QuotaExceeded')) {
        return { status: APIResponseStatus.QuotaExceeded, content: '存储空间配额已满' }
      }
      if (response.status === 409 || response.status === 412 || errorText.includes('FileAlreadyExists')) {
        return { status: APIResponseStatus.Conflict, content: '远端对象已存在，已拒绝覆盖' }
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
      const response = await this.request(`${this.getEndpoint()}/${encodeObjectName(objectName)}`, {
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
          revision: typeof content === 'string' ? await sha256Hex(content) : ''
        }
      }
      if (response.status === 404) return { status: APIResponseStatus.FileNotExist, content: '文件未找到' }

      const errorText = await readTextResponseLimited(response, 64 * 1024)
      return { status: APIResponseStatus.Fail, content: formatOssHttpError('下载', response.status, errorText) }
    } catch (error) {
      return { status: APIResponseStatus.Fail, content: formatOssError(error) }
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
      const response = await this.request(`${this.getEndpoint()}/${encodeObjectName(objectName)}`, {
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
      const errorText = await readTextResponseLimited(response, 64 * 1024).catch(() => '')
      return { status: APIResponseStatus.Fail, content: `检测失败: ${response.status} ${errorText}` }
    } catch (error) {
      return { status: APIResponseStatus.Fail, content: formatOssError(error) }
    }
  }

  async listFiles(prefix = '', maxKeys = 30, marker = ''): Promise<OSSApiResponse<OSSFileInfo[] | string>> {
    if (!this.verify()) return { status: APIResponseStatus.AuthFail, content: '配置信息不完整' }

    try {
      const normalizedPrefix = prefix.trim().replace(/^\/+/, '')
      const query = [
        `prefix=${encodeURIComponent(normalizedPrefix)}`,
        `max-keys=${Math.max(1, Math.min(100, Math.round(maxKeys)))}`,
        ...(marker ? [`marker=${encodeURIComponent(marker)}`] : [])
      ].join('&')
      const date = this.getGMTDate()
      const resource = `/${this.bucketName}/`
      const ossHeaders = `x-oss-date:${date}`
      const signature = await this.generateSignature('GET', '', '', date, ossHeaders, resource)
      const response = await this.request(`${this.getEndpoint()}/?${query}`, {
        method: 'GET',
        headers: {
          'x-oss-date': date,
          Authorization: `OSS ${this.accessKeyId}:${signature}`
        }
      })
      if (!response.ok) {
        const errorText = await readTextResponseLimited(response, 64 * 1024)
        return { status: APIResponseStatus.Fail, content: `列表失败: ${response.status} ${errorText}` }
      }

      const xmlText = await readTextResponseLimited(response, 2 * 1024 * 1024)
      const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
      const items = xmlElements(doc, 'Contents').map((node) => ({
        name: xmlElementText(node, 'Key'),
        exists: true,
        size: Number(xmlElementText(node, 'Size') || 0),
        lastModified: xmlElementText(node, 'LastModified')
      })).filter((item) => item.name)
      const isTruncated = xmlTextContent(doc, 'IsTruncated').toLowerCase() === 'true'
      const nextMarker = isTruncated ? xmlTextContent(doc, 'NextMarker') : ''
      if (isTruncated && !nextMarker) {
        return { status: APIResponseStatus.Fail, content: '列表响应缺少分页游标' }
      }
      return { status: APIResponseStatus.Success, content: items, nextMarker }
    } catch (error) {
      return { status: APIResponseStatus.Fail, content: formatOssError(error) }
    }
  }

}

export function normalizeObjectName(fileName = DEFAULT_OSS_OBJECT_NAME) {
  const trimmed = fileName.trim().replace(/^\/+/, '')
  return trimmed || DEFAULT_OSS_OBJECT_NAME
}

function encodeObjectName(fileName: string) {
  return fileName.split('/').map(encodeURIComponent).join('/')
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
    const buffer = await promiseWithTimeout(response.arrayBuffer(), '云端响应读取超时（30 秒）')
    const bytes = new Uint8Array(buffer)
    if (bytes.byteLength > maxBytes) throw new Error('云端文件超过安全上限')
    return bytes
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await promiseWithTimeout(reader.read(), '云端响应读取超时（30 秒）')
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error('云端文件超过安全上限')
      }
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  }

  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

async function promiseWithTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer = 0
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = globalThis.setTimeout(() => reject(new Error(message)), OSS_REQUEST_TIMEOUT_MS)
      })
    ])
  } finally {
    if (timer) globalThis.clearTimeout(timer)
  }
}

function formatOssError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return '云端请求已取消'
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
    if (xmlElements(doc, 'parsererror').length) throw new Error('Invalid OSS XML response')
    return {
      code: xmlTextContent(doc, 'Code'),
      message: xmlTextContent(doc, 'Message'),
      requestId: xmlTextContent(doc, 'RequestId')
    }
  } catch {
    return { code: '', message: errorText.trim().slice(0, 240), requestId: '' }
  }
}

function xmlElements(document: Document, localName: string): Element[] {
  const namespaced = [...document.getElementsByTagNameNS('*', localName)]
  return namespaced.length ? namespaced : [...document.getElementsByTagName(localName)]
}

function xmlTextContent(document: Document, localName: string): string {
  return xmlElements(document, localName)[0]?.textContent?.trim() || ''
}

function xmlElementText(element: Element, localName: string): string {
  const namespaced = [...element.getElementsByTagNameNS('*', localName)]
  const match = namespaced[0] || element.getElementsByTagName(localName)[0]
  return match?.textContent?.trim() || ''
}
