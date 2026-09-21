use hmac::{Hmac, Mac};
use sha1::Sha1;
use sha2::{Sha256, Sha512};
use std::time::{SystemTime, UNIX_EPOCH};
use url::Url;

type HmacSha1 = Hmac<Sha1>;
type HmacSha256 = Hmac<Sha256>;
type HmacSha512 = Hmac<Sha512>;

#[derive(Debug, Clone, PartialEq)]
pub struct TotpConfig {
    pub secret: String,
    pub digits: u32,
    pub period: u32,
    pub algorithm: String,
}

pub fn decode_base32_secret(secret: &str) -> Result<Vec<u8>, String> {
    let cleaned: String = secret
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect::<String>()
        .to_uppercase();

    if cleaned.is_empty() {
        return Err("TOTP secret is empty".to_string());
    }

    let unpadded = cleaned.trim_end_matches('=');
    let pad_len = (8 - (unpadded.len() % 8)) % 8;
    let mut padded = unpadded.to_string();
    padded.push_str(&"=".repeat(pad_len));

    base32_decode(&padded).ok_or_else(|| "TOTP secret is not valid base32".to_string())
}

fn base32_decode(input: &str) -> Option<Vec<u8>> {
    const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut out = Vec::new();
    let mut buffer: u64 = 0;
    let mut bits_in_buffer = 0;

    for &b in input.as_bytes() {
        if b == b'=' {
            break;
        }
        let val = ALPHABET.iter().position(|&x| x == b)? as u64;
        buffer = (buffer << 5) | val;
        bits_in_buffer += 5;

        if bits_in_buffer >= 8 {
            bits_in_buffer -= 8;
            out.push(((buffer >> bits_in_buffer) & 0xFF) as u8);
        }
    }

    Some(out)
}

pub fn parse_totp_config(
    value: &str,
    default_digits: u32,
    default_period: u32,
    default_algorithm: &str,
) -> Result<TotpConfig, String> {
    let mut secret = value.to_string();
    let mut digits = default_digits;
    let mut period = default_period;
    let mut algorithm = default_algorithm.to_string();

    if value.starts_with("otpauth://") {
        if let Ok(parsed) = Url::parse(value) {
            if parsed.host_str() == Some("totp") {
                for (k, v) in parsed.query_pairs() {
                    match k.to_lowercase().as_str() {
                        "secret" => secret = v.to_string(),
                        "digits" => {
                            if let Ok(d) = v.parse::<u32>() {
                                digits = d;
                            }
                        }
                        "period" => {
                            if let Ok(p) = v.parse::<u32>() {
                                period = p;
                            }
                        }
                        "algorithm" => algorithm = v.to_string(),
                        _ => {}
                    }
                }
            }
        }
    }

    let norm_algo = algorithm.replace('-', "").to_uppercase();
    if norm_algo != "SHA1" && norm_algo != "SHA256" && norm_algo != "SHA512" {
        return Err("Unsupported TOTP algorithm".to_string());
    }

    if !(6..=8).contains(&digits) {
        return Err("TOTP digits must be between 6 and 8".to_string());
    }
    if !(1..=300).contains(&period) {
        return Err("TOTP period must be between 1 and 300 seconds".to_string());
    }
    if secret.trim().is_empty() {
        return Err("TOTP secret is empty".to_string());
    }

    Ok(TotpConfig {
        secret,
        digits,
        period,
        algorithm: norm_algo,
    })
}

pub fn generate_totp(secret: &str, timestamp: Option<u64>) -> Result<String, String> {
    if secret.trim().is_empty() {
        return Ok(String::new());
    }

    let config = parse_totp_config(secret, 6, 30, "SHA1")?;
    let key = decode_base32_secret(&config.secret)?;

    let now = timestamp.unwrap_or_else(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    });

    let counter = now / (config.period as u64);
    let counter_bytes = counter.to_be_bytes();

    let digest = match config.algorithm.as_str() {
        "SHA1" => {
            let mut mac = HmacSha1::new_from_slice(&key).map_err(|e| e.to_string())?;
            mac.update(&counter_bytes);
            mac.finalize().into_bytes().to_vec()
        }
        "SHA256" => {
            let mut mac = HmacSha256::new_from_slice(&key).map_err(|e| e.to_string())?;
            mac.update(&counter_bytes);
            mac.finalize().into_bytes().to_vec()
        }
        "SHA512" => {
            let mut mac = HmacSha512::new_from_slice(&key).map_err(|e| e.to_string())?;
            mac.update(&counter_bytes);
            mac.finalize().into_bytes().to_vec()
        }
        _ => return Err("Unsupported algorithm".to_string()),
    };

    let offset = (digest.last().copied().unwrap_or(0) & 0x0F) as usize;
    if offset + 4 > digest.len() {
        return Err("Digest too short".to_string());
    }

    let code = u32::from_be_bytes([
        digest[offset] & 0x7F,
        digest[offset + 1],
        digest[offset + 2],
        digest[offset + 3],
    ]);

    let modulus = 10u32.pow(config.digits);
    let otp = code % modulus;
    Ok(format!("{:0width$}", otp, width = config.digits as usize))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rfc6238_vector() {
        // RFC 6238 test secret "12345678901234567890" in base32: GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
        let secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
        // Time = 59s -> counter 1
        assert_eq!(generate_totp(secret, Some(59)).unwrap(), "287082");
        // Time = 1111111109s
        assert_eq!(generate_totp(secret, Some(1111111109)).unwrap(), "081804");
    }

    #[test]
    fn test_otpauth_url() {
        let uri = "otpauth://totp/Example:alice@google.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&digits=6&period=30";
        let code = generate_totp(uri, Some(0)).unwrap();
        assert_eq!(code.len(), 6);
    }
}
