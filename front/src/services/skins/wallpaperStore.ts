import { readLocalStorage, writeLocalStorage } from '../runtime.ts'

export const WALLPAPER_SETTINGS_STORAGE_KEY = 'mypwdmg_wallpaper_settings'

export const WALLPAPER_OPACITY_MIN = 45
export const WALLPAPER_OPACITY_MAX = 100
export const WALLPAPER_OPACITY_DEFAULT = 82

export const WALLPAPER_BLUR_MIN = 0
export const WALLPAPER_BLUR_MAX = 24
export const WALLPAPER_BLUR_DEFAULT = 6

export const WALLPAPER_DIM_MIN = 0
export const WALLPAPER_DIM_MAX = 75
export const WALLPAPER_DIM_DEFAULT = 24

export const WALLPAPER_MAX_FILE_BYTES = 15 * 1024 * 1024
export const WALLPAPER_MAX_DIMENSION = 2560

const IDB_NAME = 'mypwdmg-ui-assets'
const IDB_VERSION = 1
const IDB_STORE = 'assets'
const IDB_WALLPAPER_KEY = 'wallpaper'

export interface WallpaperSettings {
  hasImage: boolean
  surfaceOpacity: number
  wallpaperBlur: number
  wallpaperDim: number
}

export const DEFAULT_WALLPAPER_SETTINGS: WallpaperSettings = {
  hasImage: false,
  surfaceOpacity: WALLPAPER_OPACITY_DEFAULT,
  wallpaperBlur: WALLPAPER_BLUR_DEFAULT,
  wallpaperDim: WALLPAPER_DIM_DEFAULT
}

const memoryAssetStore = new Map<string, string>()

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(Math.max(Math.round(num), min), max)
}

export function sanitizeWallpaperSettings(raw: unknown): WallpaperSettings {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_WALLPAPER_SETTINGS }
  }
  const obj = raw as Record<string, unknown>
  return {
    hasImage: Boolean(obj.hasImage),
    surfaceOpacity: clampInt(
      obj.surfaceOpacity,
      WALLPAPER_OPACITY_MIN,
      WALLPAPER_OPACITY_MAX,
      WALLPAPER_OPACITY_DEFAULT
    ),
    wallpaperBlur: clampInt(
      obj.wallpaperBlur,
      WALLPAPER_BLUR_MIN,
      WALLPAPER_BLUR_MAX,
      WALLPAPER_BLUR_DEFAULT
    ),
    wallpaperDim: clampInt(
      obj.wallpaperDim,
      WALLPAPER_DIM_MIN,
      WALLPAPER_DIM_MAX,
      WALLPAPER_DIM_DEFAULT
    )
  }
}

export function loadWallpaperSettings(): WallpaperSettings {
  const raw = readLocalStorage(WALLPAPER_SETTINGS_STORAGE_KEY)
  if (!raw) return { ...DEFAULT_WALLPAPER_SETTINGS }
  try {
    return sanitizeWallpaperSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_WALLPAPER_SETTINGS }
  }
}

export function saveWallpaperSettings(settings: WallpaperSettings): WallpaperSettings {
  const clean = sanitizeWallpaperSettings(settings)
  writeLocalStorage(WALLPAPER_SETTINGS_STORAGE_KEY, JSON.stringify(clean))
  return clean
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined' && typeof indexedDB.open === 'function'
}

function openAssetDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('打开本地资源数据库失败'))
  })
}

export async function saveWallpaperImage(dataUrl: string): Promise<void> {
  const value = typeof dataUrl === 'string' ? dataUrl.trim() : ''
  if (!value) {
    await clearWallpaperImage()
    return
  }
  if (!hasIndexedDb()) {
    memoryAssetStore.set(IDB_WALLPAPER_KEY, value)
    return
  }
  const db = await openAssetDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(value, IDB_WALLPAPER_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('保存背景图片失败'))
      tx.onabort = () => reject(tx.error || new Error('保存背景图片已中止'))
    })
  } finally {
    db.close()
  }
}

export async function loadWallpaperImage(): Promise<string> {
  if (!hasIndexedDb()) {
    return memoryAssetStore.get(IDB_WALLPAPER_KEY) || ''
  }
  try {
    const db = await openAssetDb()
    try {
      return await new Promise<string>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly')
        const req = tx.objectStore(IDB_STORE).get(IDB_WALLPAPER_KEY)
        req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : '')
        req.onerror = () => reject(req.error || new Error('读取背景图片失败'))
      })
    } finally {
      db.close()
    }
  } catch {
    return ''
  }
}

export async function clearWallpaperImage(): Promise<void> {
  memoryAssetStore.delete(IDB_WALLPAPER_KEY)
  if (!hasIndexedDb()) return
  try {
    const db = await openAssetDb()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite')
        tx.objectStore(IDB_STORE).delete(IDB_WALLPAPER_KEY)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error || new Error('清除背景图片失败'))
        tx.onabort = () => reject(tx.error || new Error('清除背景图片已中止'))
      })
    } finally {
      db.close()
    }
  } catch {
    // ignore cleanup failures
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') resolve(reader.result)
        else reject(new Error('读取图片数据失败'))
      }
      reader.onerror = () => reject(new Error('读取图片文件失败'))
      reader.readAsDataURL(file)
    })
  }
  return file.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i])
    }
    const base64 = btoa(binary)
    return `data:${file.type || 'image/png'};base64,${base64}`
  })
}

function maybeDownscaleDataUrl(dataUrl: string): Promise<string> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return Promise.resolve(dataUrl)
  }
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img
      if (!w || !h || (w <= WALLPAPER_MAX_DIMENSION && h <= WALLPAPER_MAX_DIMENSION)) {
        resolve(dataUrl)
        return
      }
      try {
        const scale = Math.min(WALLPAPER_MAX_DIMENSION / w, WALLPAPER_MAX_DIMENSION / h)
        const targetW = Math.max(1, Math.round(w * scale))
        const targetH = Math.max(1, Math.round(h * scale))
        const canvas = document.createElement('canvas')
        canvas.width = targetW
        canvas.height = targetH
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(dataUrl)
          return
        }
        ctx.drawImage(img, 0, 0, targetW, targetH)
        const webp = canvas.toDataURL('image/webp', 0.88)
        if (webp.startsWith('data:image/webp')) {
          resolve(webp)
          return
        }
        resolve(canvas.toDataURL('image/jpeg', 0.88))
      } catch {
        resolve(dataUrl)
      }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

export async function prepareWallpaperImageFile(file: File): Promise<string> {
  if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) {
    throw new Error('请选择有效的图片文件（PNG / JPG / WebP 等）')
  }
  if (file.size <= 0) {
    throw new Error('图片文件为空')
  }
  if (file.size > WALLPAPER_MAX_FILE_BYTES) {
    throw new Error('背景图片不能超过 15 MB')
  }
  const rawDataUrl = await readFileAsDataUrl(file)
  return maybeDownscaleDataUrl(rawDataUrl)
}
