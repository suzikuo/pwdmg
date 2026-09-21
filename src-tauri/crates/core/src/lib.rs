pub mod attachment;
pub mod crypto;
pub mod device_unlock;
pub mod domain;
pub mod native_install;
pub mod paths;
pub mod portable;
pub mod totp;
pub mod vault;

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
