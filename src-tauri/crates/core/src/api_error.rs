pub const LOCKED_MESSAGE: &str = "Vault is locked";
pub const MANUAL_LOCK_MESSAGE: &str = "Vault was manually locked; enter master password to unlock";
pub const BAD_PASSWORD_MESSAGE: &str = "Wrong password or corrupted vault";

pub fn api_error_code(message: &str) -> &'static str {
    match message {
        LOCKED_MESSAGE | MANUAL_LOCK_MESSAGE => "LOCKED",
        BAD_PASSWORD_MESSAGE => "BAD_PASSWORD",
        "Device unlock is not enabled" | "Device unlock session expired" => "DISABLED",
        "Device unlock is only supported on Windows" => "UNSUPPORTED",
        "Vault file exceeds the safe size limit"
        | "Vault envelope is not valid JSON" => "INVALID_VAULT",
        "Fill hostname is required"
        | "Captured password is empty"
        | "Entry not found"
        | "Entry is not authorized for this site"
        | "No entries in vault"
        | "No entries"
        | "Target folder not found"
        | "Target is not a folder"
        | "Attachment ID is invalid"
        | "Reauth interval outside supported range"
        | "Portable backup selection has expired"
        | "请输入 Chrome/Edge 扩展页里的 32 位插件 ID" => "INVALID_INPUT",
        message if message.starts_with("Conflict:")
            || message.starts_with("Revision mismatch:")
            || message.starts_with("Vault revision must advance by exactly one:") => "CONFLICT",
        message if message.starts_with("Invalid vault envelope:")
            || message.starts_with("Unsupported vault ")
            || message.starts_with("Vault envelope is malformed")
            || message.starts_with("Vault KDF ")
            || message.starts_with("Vault salt ")
            || message.starts_with("Vault nonce ")
            || message.starts_with("Vault ciphertext ")
            || message.starts_with("Vault field is not valid base64") => "INVALID_VAULT",
        message if message.starts_with("Invalid ")
            || message.starts_with("Missing ")
            || message.starts_with("TOTP ") => "INVALID_INPUT",
        _ => "ERROR",
    }
}
