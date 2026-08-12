import jsQR from 'jsqr'

export const MAX_QR_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_QR_IMAGE_PIXELS = 20_000_000
export const MAX_QR_IMAGE_DIMENSION = 8192
export const MAX_QR_DECODE_PIXELS = 4_000_000
export const MAX_QR_DECODE_DIMENSION = 2048

const MAX_QR_PAYLOAD_CHARS = 4096
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/bmp'])
const ALLOWED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp'])

type QrImageMetadata = Pick<File, 'name' | 'size' | 'type'>

export function validateQrImageMetadata(file: QrImageMetadata) {
  const name = String(file?.name || '').trim()
  const size = Number(file?.size)
  const type = String(file?.type || '').trim().toLowerCase()
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : ''

  if (!name || !Number.isSafeInteger(size) || size < 1) throw new Error('二维码图片为空')
  if (size > MAX_QR_IMAGE_BYTES) throw new Error('二维码图片不能超过 10 MiB')
  if (type ? !ALLOWED_IMAGE_TYPES.has(type) : !ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
    throw new Error('请选择 PNG、JPG、WebP 或 BMP 图片')
  }
}

export function getQrDecodeDimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error('二维码图片尺寸无效')
  }
  if (width > MAX_QR_IMAGE_DIMENSION || height > MAX_QR_IMAGE_DIMENSION || width * height > MAX_QR_IMAGE_PIXELS) {
    throw new Error('二维码图片尺寸过大')
  }

  const scale = Math.min(
    1,
    MAX_QR_DECODE_DIMENSION / Math.max(width, height),
    Math.sqrt(MAX_QR_DECODE_PIXELS / (width * height))
  )
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}

export async function decodeQrImageFile(file: File) {
  validateQrImageMetadata(file)
  const loaded = await loadImage(file)
  let canvas: HTMLCanvasElement | null = null
  try {
    const dimensions = getQrDecodeDimensions(loaded.width, loaded.height)
    canvas = document.createElement('canvas')
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
    if (!context) throw new Error('当前桌面环境无法读取二维码图片')
    context.drawImage(loaded.source, 0, 0, dimensions.width, dimensions.height)
    const pixels = context.getImageData(0, 0, dimensions.width, dimensions.height)
    const decoded = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' })
    const value = String(decoded?.data || '').trim()
    if (!value) throw new Error('图片中未识别到二维码')
    if (value.length > MAX_QR_PAYLOAD_CHARS) throw new Error('二维码内容过长')
    return value
  } catch (error) {
    if (error instanceof Error) throw error
    throw new Error('二维码图片识别失败')
  } finally {
    loaded.close()
    if (canvas) {
      canvas.width = 1
      canvas.height = 1
    }
  }
}

async function loadImage(file: File): Promise<{
  source: CanvasImageSource
  width: number
  height: number
  close: () => void
}> {
  try {
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          close: () => bitmap.close()
        }
      } catch {
        // Older WebViews may expose createImageBitmap without supporting options.
      }
    }

    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    try {
      image.src = objectUrl
      await image.decode()
      URL.revokeObjectURL(objectUrl)
      return {
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        close: () => { image.src = '' }
      }
    } catch (error) {
      URL.revokeObjectURL(objectUrl)
      throw error
    }
  } catch {
    throw new Error('无法读取所选二维码图片')
  }
}
