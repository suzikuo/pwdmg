/// <reference types="vite/client" />

declare global {
  interface Window {
    pywebview?: {
      api?: Record<string, (...args: any[]) => Promise<any>>
    }
    androidPasswordApi?: Record<string, (...args: any[]) => string>
    __mypwdmgHandleNativeBack?: () => boolean
  }
}

export {}
