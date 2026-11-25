use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

pub const DEFAULT_CLEAR_AFTER_SECS: u64 = 30;
pub const MAX_CLEAR_AFTER_SECS: u64 = 300;
const NO_SEQUENCE: u64 = u64::MAX;

#[derive(Default)]
struct ClipboardInner {
    generation: AtomicU64,
    owned_sequence: AtomicU64,
}

impl ClipboardInner {
    fn new() -> Self {
        Self {
            generation: AtomicU64::new(0),
            owned_sequence: AtomicU64::new(NO_SEQUENCE),
        }
    }
}

#[derive(Clone)]
pub struct SecureClipboard {
    inner: Arc<ClipboardInner>,
}

impl Default for SecureClipboard {
    fn default() -> Self {
        Self::new()
    }
}

pub fn normalize_clear_after_secs(clear_after_secs: Option<u64>) -> u64 {
    clear_after_secs
        .filter(|&secs| secs > 0)
        .unwrap_or(DEFAULT_CLEAR_AFTER_SECS)
        .min(MAX_CLEAR_AFTER_SECS)
}

impl SecureClipboard {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(ClipboardInner::new()),
        }
    }

    /// Copies sensitive text to the native OS clipboard with privacy markers
    /// (excluding Windows Clipboard History & Cloud Clipboard) and schedules
    /// automatic clearing after `clear_after_secs` (default 30s) if the
    /// clipboard has not been modified by another copy in the meantime.
    #[cfg(windows)]
    pub fn copy_sensitive(&self, text: &str, clear_after_secs: Option<u64>) -> Result<u64, String> {
        let secs = normalize_clear_after_secs(clear_after_secs);
        let seq = win32::write_sensitive_clipboard(text)?;

        let generation = self.inner.generation.fetch_add(1, Ordering::SeqCst) + 1;
        self.inner.owned_sequence.store(u64::from(seq), Ordering::SeqCst);

        let inner = Arc::clone(&self.inner);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(secs));
            if inner.generation.load(Ordering::SeqCst) != generation {
                return;
            }
            win32::clear_if_sequence_matches(&inner, seq);
        });

        Ok(secs)
    }

    #[cfg(not(windows))]
    pub fn copy_sensitive(&self, _text: &str, _clear_after_secs: Option<u64>) -> Result<u64, String> {
        Err("Native secure clipboard is not supported on this platform".to_string())
    }

    /// Immediately clears the OS clipboard if it still contains the last
    /// sensitive value written by this instance (sequence number unchanged).
    #[cfg(windows)]
    pub fn clear_if_owned(&self) -> bool {
        self.inner.generation.fetch_add(1, Ordering::SeqCst);
        let recorded = self.inner.owned_sequence.swap(NO_SEQUENCE, Ordering::SeqCst);
        if recorded == NO_SEQUENCE {
            return false;
        }
        win32::clear_clipboard_if_sequence(recorded as u32)
    }

    #[cfg(not(windows))]
    pub fn clear_if_owned(&self) -> bool {
        self.inner.generation.fetch_add(1, Ordering::SeqCst);
        self.inner.owned_sequence.store(NO_SEQUENCE, Ordering::SeqCst);
        false
    }
}

#[cfg(windows)]
mod win32 {
    use super::{ClipboardInner, NO_SEQUENCE};
    use std::sync::atomic::Ordering;
    use std::time::Duration;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardSequenceNumber, OpenClipboard,
        RegisterClipboardFormatW, SetClipboardData,
    };
    use windows::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };
    use zeroize::Zeroize;

    const CF_UNICODETEXT: u32 = 13;

    struct ClipboardGuard;

    impl ClipboardGuard {
        fn open() -> Result<Self, String> {
            for attempt in 0..5 {
                let opened = unsafe { OpenClipboard(HWND::default()) };
                if opened.is_ok() {
                    return Ok(Self);
                }
                if attempt < 4 {
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
            Err("Failed to open Windows clipboard".to_string())
        }
    }

    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }

    fn alloc_and_set_format(format: u32, bytes: &[u8]) -> Result<(), String> {
        unsafe {
            let hmem: HGLOBAL = GlobalAlloc(GMEM_MOVEABLE, bytes.len())
                .map_err(|e| format!("GlobalAlloc failed: {e}"))?;
            let ptr = GlobalLock(hmem);
            if ptr.is_null() {
                let _ = GlobalFree(hmem);
                return Err("GlobalLock returned null".to_string());
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr as *mut u8, bytes.len());
            let _ = GlobalUnlock(hmem);

            if let Err(err) = SetClipboardData(format, HANDLE(hmem.0)) {
                let _ = GlobalFree(hmem);
                return Err(format!("SetClipboardData failed: {err}"));
            }
        }
        Ok(())
    }

    fn set_privacy_dword_marker(format_name: &str, value: u32) {
        let wide_name: Vec<u16> = format_name
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let format_id = unsafe { RegisterClipboardFormatW(PCWSTR(wide_name.as_ptr())) };
        if format_id != 0 {
            let _ = alloc_and_set_format(format_id, &value.to_ne_bytes());
        }
    }

    pub(super) fn write_sensitive_clipboard(text: &str) -> Result<u32, String> {
        let mut utf16: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        let byte_len = utf16.len() * std::mem::size_of::<u16>();
        let raw_bytes = unsafe { std::slice::from_raw_parts(utf16.as_ptr() as *const u8, byte_len) };

        let write_result: Result<(), String> = (|| {
            let _guard = ClipboardGuard::open()?;
            unsafe {
                EmptyClipboard().map_err(|e| format!("EmptyClipboard failed: {e}"))?;
            }
            alloc_and_set_format(CF_UNICODETEXT, raw_bytes)?;

            // Exclude copied credentials from Windows Clipboard History (Win+V),
            // Cloud Clipboard sync, and third-party clipboard monitor processing.
            set_privacy_dword_marker("ExcludeClipboardContentFromMonitorProcessing", 0);
            set_privacy_dword_marker("CanIncludeInClipboardHistory", 0);
            set_privacy_dword_marker("CanUploadToCloudClipboard", 0);
            Ok(())
        })();

        utf16.zeroize();
        write_result?;

        Ok(unsafe { GetClipboardSequenceNumber() })
    }

    pub(super) fn clear_if_sequence_matches(inner: &ClipboardInner, expected_seq: u32) -> bool {
        if inner.owned_sequence.load(Ordering::SeqCst) != u64::from(expected_seq) {
            return false;
        }
        let cleared = clear_clipboard_if_sequence(expected_seq);
        let _ = inner.owned_sequence.compare_exchange(
            u64::from(expected_seq),
            NO_SEQUENCE,
            Ordering::SeqCst,
            Ordering::SeqCst,
        );
        cleared
    }

    pub(super) fn clear_clipboard_if_sequence(expected_seq: u32) -> bool {
        if unsafe { GetClipboardSequenceNumber() } != expected_seq {
            return false;
        }
        let Ok(_guard) = ClipboardGuard::open() else {
            return false;
        };
        // Re-check sequence number after acquiring the clipboard lock to avoid TOCTOU races.
        if unsafe { GetClipboardSequenceNumber() } != expected_seq {
            return false;
        }
        unsafe { EmptyClipboard().is_ok() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_clear_after_secs_clamps_and_defaults() {
        assert_eq!(normalize_clear_after_secs(None), DEFAULT_CLEAR_AFTER_SECS);
        assert_eq!(normalize_clear_after_secs(Some(0)), DEFAULT_CLEAR_AFTER_SECS);
        assert_eq!(normalize_clear_after_secs(Some(15)), 15);
        assert_eq!(normalize_clear_after_secs(Some(9999)), MAX_CLEAR_AFTER_SECS);
    }

    #[test]
    fn clear_if_owned_returns_false_when_nothing_was_copied() {
        let clipboard = SecureClipboard::new();
        assert!(!clipboard.clear_if_owned());
    }
}
