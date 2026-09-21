use std::fmt;
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::prelude::*;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use zeroize::{Zeroize, ZeroizeOnDrop};

pub const DEFAULT_ITERATIONS: u32 = 390_000;
pub const MIN_KDF_ITERATIONS: u32 = 10_000;
pub const MAX_KDF_ITERATIONS: u32 = 2_000_000;
pub const SALT_BYTES: usize = 16;
pub const NONCE_BYTES: usize = 12;
pub const MIN_CIPHERTEXT_BYTES: usize = 16;
pub const MAX_CIPHERTEXT_BYTES: usize = 16 * 1024 * 1024 + MIN_CIPHERTEXT_BYTES;
pub const MAX_PLAINTEXT_BYTES: usize = MAX_CIPHERTEXT_BYTES - MIN_CIPHERTEXT_BYTES;
pub const MAX_REVISION: u64 = (1u64 << 53) - 1;

pub static AAD_V1: &[u8] = b"mypwdmg-vault-v1";
pub static AAD_V2: &[u8] = b"mypwdmg-vault-v2";

#[derive(Debug)]
pub enum VaultCryptoError {
    InvalidFormat,
    UnsupportedVersion(u32),
    UnsupportedCipher(String),
    UnsupportedKdf(String),
    InvalidIterations(u32),
    InvalidSaltLength(usize),
    InvalidNonceLength(usize),
    InvalidCiphertextLength(usize),
    InvalidBase64(String),
    PayloadTooLarge,
    WrongPasswordOrCorrupted,
    InvalidJson(String),
    InvalidRevision(String),
    MalformedEnvelope(String),
}

impl fmt::Display for VaultCryptoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidFormat => write!(f, "Unsupported vault format"),
            Self::UnsupportedVersion(v) => write!(f, "Unsupported vault version: {}", v),
            Self::UnsupportedCipher(c) => write!(f, "Unsupported vault cipher: {}", c),
            Self::UnsupportedKdf(k) => write!(f, "Unsupported vault KDF: {}", k),
            Self::InvalidIterations(i) => write!(f, "Vault KDF iteration count is outside the supported range: {}", i),
            Self::InvalidSaltLength(l) => write!(f, "Vault salt has an invalid length: {}", l),
            Self::InvalidNonceLength(l) => write!(f, "Vault nonce has an invalid length: {}", l),
            Self::InvalidCiphertextLength(l) => write!(f, "Vault ciphertext has an invalid length: {}", l),
            Self::InvalidBase64(e) => write!(f, "Vault field is not valid base64: {}", e),
            Self::PayloadTooLarge => write!(f, "Vault payload is too large"),
            Self::WrongPasswordOrCorrupted => write!(f, "Wrong password or corrupted vault"),
            Self::InvalidJson(e) => write!(f, "Vault payload is not valid JSON: {}", e),
            Self::InvalidRevision(e) => write!(f, "Vault revision is invalid: {}", e),
            Self::MalformedEnvelope(e) => write!(f, "Vault envelope is malformed: {}", e),
        }
    }
}

impl std::error::Error for VaultCryptoError {}

#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct VaultKey {
    pub key: [u8; 32],
    pub salt: [u8; 16],
    pub iterations: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct KdfInfo {
    pub name: String,
    pub iterations: u32,
    pub salt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VaultEnvelope {
    pub format: String,
    pub version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<u64>,
    pub cipher: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passwordless: Option<bool>,
    pub kdf: KdfInfo,
    pub nonce: String,
    pub ciphertext: String,
}

pub fn derive_key(password: &str, salt: &[u8], iterations: u32) -> Result<[u8; 32], VaultCryptoError> {
    if salt.len() != SALT_BYTES {
        return Err(VaultCryptoError::InvalidSaltLength(salt.len()));
    }
    if !(MIN_KDF_ITERATIONS..=MAX_KDF_ITERATIONS).contains(&iterations) {
        return Err(VaultCryptoError::InvalidIterations(iterations));
    }

    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<sha2::Sha256>(password.as_bytes(), salt, iterations, &mut key);
    Ok(key)
}

pub fn validate_revision(val: u64) -> Result<u64, VaultCryptoError> {
    if val > MAX_REVISION {
        return Err(VaultCryptoError::InvalidRevision(format!("Revision exceeds max: {}", val)));
    }
    Ok(val)
}

pub fn payload_version_for_encryption(payload: &Value) -> u32 {
    if let Some(v) = payload.get("version").and_then(|v| v.as_u64()) {
        if v == 2 {
            return 2;
        }
    }
    if let Some(settings) = payload.get("settings").and_then(|s| s.as_object()) {
        if settings.get("passkeys").is_some() || settings.get("passkeyTombstones").is_some() {
            return 2;
        }
    }
    1
}

pub fn aad_for_version(version: u32) -> Result<&'static [u8], VaultCryptoError> {
    match version {
        1 => Ok(AAD_V1),
        2 => Ok(AAD_V2),
        v => Err(VaultCryptoError::UnsupportedVersion(v)),
    }
}

pub fn encrypt_payload(
    password: &str,
    payload: &Value,
    iterations: Option<u32>,
) -> Result<(VaultEnvelope, VaultKey), VaultCryptoError> {
    let iters = iterations.unwrap_or(DEFAULT_ITERATIONS);
    if !(MIN_KDF_ITERATIONS..=MAX_KDF_ITERATIONS).contains(&iters) {
        return Err(VaultCryptoError::InvalidIterations(iters));
    }

    let mut salt = [0u8; SALT_BYTES];
    rand::thread_rng().fill_bytes(&mut salt);

    let key = derive_key(password, &salt, iters)?;
    let vault_key = VaultKey {
        key,
        salt,
        iterations: iters,
    };

    let mut envelope = encrypt_payload_with_key(&vault_key, payload)?;
    envelope.passwordless = Some(password.is_empty());

    Ok((envelope, vault_key))
}

pub fn encrypt_payload_with_key(
    vault_key: &VaultKey,
    payload: &Value,
) -> Result<VaultEnvelope, VaultCryptoError> {
    if !(MIN_KDF_ITERATIONS..=MAX_KDF_ITERATIONS).contains(&vault_key.iterations) {
        return Err(VaultCryptoError::InvalidIterations(vault_key.iterations));
    }

    let version = payload_version_for_encryption(payload);
    let aad = aad_for_version(version)?;

    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);

    let raw = serde_json::to_vec(payload).map_err(|e| VaultCryptoError::InvalidJson(e.to_string()))?;
    if raw.len() > MAX_PLAINTEXT_BYTES {
        return Err(VaultCryptoError::PayloadTooLarge);
    }

    let cipher = Aes256Gcm::new_from_slice(&vault_key.key)
        .map_err(|_| VaultCryptoError::WrongPasswordOrCorrupted)?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext_bytes = cipher
        .encrypt(nonce, Payload { msg: &raw, aad })
        .map_err(|_| VaultCryptoError::WrongPasswordOrCorrupted)?;

    let revision = payload
        .get("revision")
        .and_then(|r| r.as_u64())
        .map(validate_revision)
        .transpose()?;

    Ok(VaultEnvelope {
        format: "mypwdmg-vault".to_string(),
        version,
        revision,
        cipher: "AES-256-GCM".to_string(),
        passwordless: None,
        kdf: KdfInfo {
            name: "PBKDF2-HMAC-SHA256".to_string(),
            iterations: vault_key.iterations,
            salt: BASE64_STANDARD.encode(vault_key.salt),
        },
        nonce: BASE64_STANDARD.encode(nonce_bytes),
        ciphertext: BASE64_STANDARD.encode(ciphertext_bytes),
    })
}

pub fn decrypt_payload(
    password: &str,
    envelope: &VaultEnvelope,
) -> Result<(Value, VaultKey), VaultCryptoError> {
    if envelope.format != "mypwdmg-vault" {
        return Err(VaultCryptoError::InvalidFormat);
    }
    if envelope.cipher != "AES-256-GCM" {
        return Err(VaultCryptoError::UnsupportedCipher(envelope.cipher.clone()));
    }
    if envelope.kdf.name != "PBKDF2-HMAC-SHA256" {
        return Err(VaultCryptoError::UnsupportedKdf(envelope.kdf.name.clone()));
    }
    let iterations = envelope.kdf.iterations;
    if !(MIN_KDF_ITERATIONS..=MAX_KDF_ITERATIONS).contains(&iterations) {
        return Err(VaultCryptoError::InvalidIterations(iterations));
    }

    let salt_bytes = BASE64_STANDARD
        .decode(&envelope.kdf.salt)
        .map_err(|e| VaultCryptoError::InvalidBase64(e.to_string()))?;
    if salt_bytes.len() != SALT_BYTES {
        return Err(VaultCryptoError::InvalidSaltLength(salt_bytes.len()));
    }
    let mut salt = [0u8; SALT_BYTES];
    salt.copy_from_slice(&salt_bytes);

    let key = derive_key(password, &salt, iterations)?;
    let vault_key = VaultKey {
        key,
        salt,
        iterations,
    };

    let payload = decrypt_payload_with_key(&vault_key, envelope)?;
    Ok((payload, vault_key))
}

pub fn decrypt_payload_with_key(
    vault_key: &VaultKey,
    envelope: &VaultEnvelope,
) -> Result<Value, VaultCryptoError> {
    if envelope.format != "mypwdmg-vault" {
        return Err(VaultCryptoError::InvalidFormat);
    }
    if envelope.cipher != "AES-256-GCM" {
        return Err(VaultCryptoError::UnsupportedCipher(envelope.cipher.clone()));
    }

    if envelope.kdf.name != "PBKDF2-HMAC-SHA256" {
        return Err(VaultCryptoError::UnsupportedKdf(envelope.kdf.name.clone()));
    }
    let envelope_salt = BASE64_STANDARD
        .decode(&envelope.kdf.salt)
        .map_err(|e| VaultCryptoError::InvalidBase64(e.to_string()))?;
    if envelope_salt.len() != SALT_BYTES {
        return Err(VaultCryptoError::InvalidSaltLength(envelope_salt.len()));
    }
    if vault_key.iterations != envelope.kdf.iterations || vault_key.salt.as_slice() != envelope_salt.as_slice() {
        return Err(VaultCryptoError::WrongPasswordOrCorrupted);
    }

    let aad = aad_for_version(envelope.version)?;

    let nonce_bytes = BASE64_STANDARD
        .decode(&envelope.nonce)
        .map_err(|e| VaultCryptoError::InvalidBase64(e.to_string()))?;
    if nonce_bytes.len() != NONCE_BYTES {
        return Err(VaultCryptoError::InvalidNonceLength(nonce_bytes.len()));
    }

    let ciphertext_bytes = BASE64_STANDARD
        .decode(&envelope.ciphertext)
        .map_err(|e| VaultCryptoError::InvalidBase64(e.to_string()))?;
    if ciphertext_bytes.len() < MIN_CIPHERTEXT_BYTES || ciphertext_bytes.len() > MAX_CIPHERTEXT_BYTES {
        return Err(VaultCryptoError::InvalidCiphertextLength(ciphertext_bytes.len()));
    }

    let cipher = Aes256Gcm::new_from_slice(&vault_key.key)
        .map_err(|_| VaultCryptoError::WrongPasswordOrCorrupted)?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext_bytes = cipher
        .decrypt(nonce, Payload { msg: &ciphertext_bytes, aad })
        .map_err(|_| VaultCryptoError::WrongPasswordOrCorrupted)?;

    let payload: Value = serde_json::from_slice(&plaintext_bytes)
        .map_err(|e| VaultCryptoError::InvalidJson(e.to_string()))?;

    if !payload.is_object() {
        return Err(VaultCryptoError::MalformedEnvelope("Vault payload must be an object".to_string()));
    }

    // Verify version consistency
    if let Some(pv) = payload.get("version").and_then(|v| v.as_u64()) {
        if pv as u32 != envelope.version {
            return Err(VaultCryptoError::UnsupportedVersion(envelope.version));
        }
    }

    // Verify revision consistency if present in both
    if let Some(env_rev) = envelope.revision {
        if let Some(pay_rev) = payload.get("revision").and_then(|r| r.as_u64()) {
            if env_rev != pay_rev {
                return Err(VaultCryptoError::InvalidRevision("Envelope and payload revision mismatch".to_string()));
            }
        }
    }

    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let payload = json!({
            "version": 1,
            "revision": 42,
            "entries": [
                {
                    "id": "item-1",
                    "title": "Example",
                    "username": "user123",
                    "password": "secretpassword"
                }
            ]
        });

        let password = "my-secure-master-password";
        let (envelope, _key) = encrypt_payload(password, &payload, Some(10_000)).unwrap();

        assert_eq!(envelope.format, "mypwdmg-vault");
        assert_eq!(envelope.version, 1);
        assert_eq!(envelope.revision, Some(42));
        assert_eq!(envelope.passwordless, Some(false));

        let (decrypted, _key2) = decrypt_payload(password, &envelope).unwrap();
        assert_eq!(decrypted, payload);

        // Wrong password fails
        assert!(decrypt_payload("wrong-password", &envelope).is_err());
    }

    #[test]
    fn test_v2_passkey_version_promotion() {
        let payload = json!({
            "version": 2,
            "revision": 1,
            "entries": [],
            "settings": {
                "passkeys": []
            }
        });

        let (envelope, _) = encrypt_payload("pass", &payload, Some(10_000)).unwrap();
        assert_eq!(envelope.version, 2);

        let (decrypted, _) = decrypt_payload("pass", &envelope).unwrap();
        assert_eq!(decrypted["version"], 2);
    }
}
