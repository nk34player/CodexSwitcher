use keyring::Entry;

const SERVICE_NAME: &str = "com.openai.codex-switcher";

#[cfg(target_os = "linux")]
fn map_keyring_error(operation: &str, error: keyring::Error) -> String {
    let raw = error.to_string();
    let lowered = raw.to_lowercase();

    if lowered.contains("secret service")
        || lowered.contains("no such secret collection")
        || lowered.contains("dbus")
        || lowered.contains("org.freedesktop.secrets")
        || lowered.contains("service unknown")
        || lowered.contains("no response")
        || lowered.contains("timed out")
    {
        return format!(
            "Linux Secret Service is unavailable while trying to {}. Start a supported keyring daemon such as gnome-keyring or KWallet and make sure a DBus session is running. Original error: {}",
            operation, raw
        );
    }

    format!("Failed to {} using the Linux keyring backend: {}", operation, raw)
}

#[cfg(not(target_os = "linux"))]
fn map_keyring_error(operation: &str, error: keyring::Error) -> String {
    format!("Failed to {}: {}", operation, error)
}

pub fn set_password(key: &str, secret: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, key)
        .map_err(|e| map_keyring_error("open a secure credential entry", e))?;
    entry
        .set_password(secret)
        .map_err(|e| map_keyring_error("store credentials", e))?;
    Ok(())
}

pub fn get_password(key: &str) -> Result<String, String> {
    let entry = Entry::new(SERVICE_NAME, key)
        .map_err(|e| map_keyring_error("open a secure credential entry", e))?;
    entry
        .get_password()
        .map_err(|e| map_keyring_error("read credentials", e))
}

pub fn delete_password(key: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, key)
        .map_err(|e| map_keyring_error("open a secure credential entry", e))?;
    // It is fine if it doesn't exist, we can ignore that error
    let _ = entry.delete_credential();
    Ok(())
}
