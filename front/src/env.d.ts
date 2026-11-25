/// <reference types="vite/client" />

declare global {
  interface Window {
    pywebview?: {
      api?: Record<string, (...args: any[]) => Promise<any>>
    }
    androidPasswordApi?: Record<string, (...args: any[]) => string>
    __TAURI_INTERNALS__?: {
      invoke?: (cmd: string, payload?: Record<string, unknown>) => Promise<unknown>
    }
    __TAURI__?: {
      core?: {
        invoke?: (cmd: string, payload?: Record<string, unknown>) => Promise<unknown>
      }
      event?: {
        listen?: <T = unknown>(
          event: string,
          handler: (event: { event?: string; payload?: T }) => void
        ) => Promise<() => void> | (() => void)
      }
    }
    __mypwdmgHandleNativeBack?: () => boolean
    __mypwdmgHandleNativeLock?: () => boolean
    __mypwdmgHandleNativeAutofillIntent?: () => boolean
  }
}

export {}
