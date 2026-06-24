use crate::error::{AppError, AppResult};

const SERVICE: &str = "com.thebguy.gitdesktop";
const KNOWN_PROVIDERS: &[&str] = &[
    "anthropic",
    "openai",
    "openai-compatible",
    "openrouter",
    "ollama",
    "ollama-cloud",
];

fn entry_for(provider: &str) -> AppResult<keyring::Entry> {
    if !KNOWN_PROVIDERS.contains(&provider) {
        return Err(AppError::InvalidArgument(format!(
            "unknown provider: {provider}"
        )));
    }
    keyring::Entry::new(SERVICE, &format!("ai-api-key/{provider}"))
        .map_err(|e| AppError::Keyring(e.to_string()))
}

#[tauri::command]
pub async fn set_secret(provider: String, value: String) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        entry_for(&provider)?
            .set_password(&value)
            .map_err(|e| AppError::Keyring(e.to_string()))
    })
    .await
    .map_err(|e| AppError::Keyring(e.to_string()))?
}

#[tauri::command]
pub async fn get_secret(provider: String) -> AppResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || match entry_for(&provider)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Keyring(e.to_string())),
    })
    .await
    .map_err(|e| AppError::Keyring(e.to_string()))?
}

#[tauri::command]
pub async fn delete_secret(provider: String) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        match entry_for(&provider)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Keyring(e.to_string())),
        }
    })
    .await
    .map_err(|e| AppError::Keyring(e.to_string()))?
}

#[tauri::command]
pub async fn secret_exists(provider: String) -> AppResult<bool> {
    Ok(get_secret(provider).await?.is_some())
}
