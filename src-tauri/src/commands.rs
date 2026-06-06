use std::fs;
use std::path::Path;
use sysinfo::System;
use crate::profile_manager::{
    self, Profile, ConfigState, ProfileAnalytics, BackupInfo,
    get_profiles_dir, get_default_codex_dir,
    get_app_config_dir, load_config_state, save_config_state,
    copy_dir_all, safe_clear_dir
};
use crate::keychain;
use serde::{Serialize, Deserialize};
use chrono::Utc;
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use tauri::Emitter;
use std::process::Command;

static ACTIVE_PROFILE_REFRESHES: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LogEntry {
    pub timestamp: String,
    pub action: String,
    pub message: String,
}

fn add_activity_log(action: &str, message: &str) {
    let log_path = get_app_config_dir().join("activity_log.json");
    let mut logs = Vec::new();
    if log_path.exists() {
        if let Ok(content) = fs::read_to_string(&log_path) {
            if let Ok(existing) = serde_json::from_str::<Vec<LogEntry>>(&content) {
                logs = existing;
            }
        }
    }
    logs.push(LogEntry {
        timestamp: Utc::now().to_rfc3339(),
        action: action.to_string(),
        message: message.to_string(),
    });
    // Cap at 100 entries to save space
    if logs.len() > 100 {
        logs.remove(0);
    }
    if let Ok(serialized) = serde_json::to_string_pretty(&logs) {
        let _ = fs::write(log_path, serialized);
    }
}

#[tauri::command]
pub fn check_codex_status() -> Result<bool, String> {
    let mut s = System::new_all();
    s.refresh_processes();
    let current_pid = sysinfo::Pid::from_u32(std::process::id());
    for (&pid, process) in s.processes() {
        if pid == current_pid {
            continue;
        }
        let name = process.name().to_lowercase();
        let exe_path = process.exe().map(|p| p.to_string_lossy().to_lowercase()).unwrap_or_default();
        
        let is_main_binary = name == "codex" || name == "codex.exe";
        let is_macos_main_path = exe_path.ends_with("/contents/macos/codex");

        if (is_main_binary || is_macos_main_path)
            && !name.contains("switcher") 
            && !exe_path.contains("switcher") 
        {
            return Ok(true);
        }
    }
    Ok(false)
}

#[tauri::command]
pub fn close_codex() -> Result<(), String> {
    let mut s = System::new_all();
    s.refresh_processes();
    let current_pid = sysinfo::Pid::from_u32(std::process::id());
    let mut killed_any = false;
    for (&pid, process) in s.processes() {
        if pid == current_pid {
            continue;
        }
        let name = process.name().to_lowercase();
        let exe_path = process.exe().map(|p| p.to_string_lossy().to_lowercase()).unwrap_or_default();
        if (name.contains("codex") || exe_path.contains("codex.app")) 
            && !name.contains("switcher") 
            && !exe_path.contains("switcher") 
        {
            process.kill();
            killed_any = true;
        }
    }
    if killed_any {
        add_activity_log("Terminate Process", "Closed running instances of Codex desktop app.");
    }
    std::thread::sleep(std::time::Duration::from_millis(500));
    Ok(())
}

#[tauri::command]
pub fn launch_codex(custom_path: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(ref path) = custom_path {
            if Path::new(path).exists() {
                std::process::Command::new("open")
                    .arg(path)
                    .spawn()
                    .map_err(|e| format!("Failed to launch custom path: {}", e))?;
                add_activity_log("Launch Process", &format!("Launched Codex from custom path: {}", path));
                return Ok(());
            }
        }
        
        // Default launch via bundle identifier
        if std::process::Command::new("open")
            .arg("-b")
            .arg("com.openai.codex")
            .spawn()
            .is_ok()
        {
            add_activity_log("Launch Process", "Launched Codex via Bundle ID.");
            return Ok(());
        }
        
        // Fallback launch via path
        std::process::Command::new("open")
            .arg("/Applications/Codex.app")
            .spawn()
            .map_err(|e| format!("Failed to launch Codex: {}", e))?;
        add_activity_log("Launch Process", "Launched Codex from /Applications/Codex.app.");
    }
    
    #[cfg(target_os = "windows")]
    {
        let path = if let Some(ref p) = custom_path {
            p.clone()
        } else {
            let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
            let p1 = Path::new(&local_appdata).join("Programs").join("Codex").join("Codex.exe");
            if p1.exists() {
                p1.to_string_lossy().to_string()
            } else {
                let program_files = std::env::var("ProgramFiles").unwrap_or_default();
                let p2 = Path::new(&program_files).join("Codex").join("Codex.exe");
                p2.to_string_lossy().to_string()
            }
        };
        
        std::process::Command::new(&path)
            .spawn()
            .map_err(|e| format!("Failed to launch Codex: {}", e))?;
        add_activity_log("Launch Process", &format!("Launched Codex executable at: {}", path));
    }
    
    #[cfg(target_os = "linux")]
    {
        if let Some(ref path) = custom_path {
            std::process::Command::new(path)
                .spawn()
                .map_err(|e| format!("Failed to launch custom path: {}", e))?;
            add_activity_log("Launch Process", &format!("Launched Codex executable on Linux at: {}", path));
        } else {
            return Err("Codex executable path not configured on Linux. Please specify path in settings.".to_string());
        }
    }
    
    Ok(())
}

#[tauri::command]
pub fn get_profiles() -> Result<ConfigState, String> {
    let mut state = load_config_state();
    
    if state.profiles.is_empty() {
        let codex_dir = get_default_codex_dir();
        if codex_dir.exists() && (codex_dir.join("auth.json").exists() || codex_dir.join("config.toml").exists()) {
            let (plan, email, display_name) = profile_manager::detect_auth_details(&codex_dir);
            let profile_id = "p_default".to_string();
            
            let name = if let Some(ref email_str) = email {
                email_str.clone()
            } else {
                "Active Profile".to_string()
            };
            
            let default_profile = Profile {
                id: profile_id.clone(),
                name,
                email,
                display_name,
                plan,
                avatar_color: "#00f0ff".to_string(),
                avatar_emoji: "💻".to_string(),
                is_default: true,
                shares_config_with: None,
            };
            
            let target_profile_dir = get_profiles_dir().join(&profile_id);
            let _ = safe_clear_dir(&target_profile_dir);
            if copy_dir_all(&codex_dir, &target_profile_dir).is_ok() {
                state.active_profile_id = Some(profile_id);
                state.profiles.push(default_profile);
                let _ = save_config_state(&state);
                add_activity_log("Profile Import", "Automatically detected and imported existing active Codex session.");
            }
        }
    }
    
    Ok(state)
}

#[tauri::command]
pub fn hydrate_boot_state() -> Result<ConfigState, String> {
    let mut state = load_config_state();
    let codex_dir = get_default_codex_dir();
    let active_profile_id = state.active_profile_id.clone();
    let mut changed = false;

    for profile in &mut state.profiles {
        let source_dir = if active_profile_id.as_deref() == Some(profile.id.as_str()) && codex_dir.exists() {
            codex_dir.clone()
        } else {
            get_profiles_dir().join(&profile.id)
        };

        if !source_dir.exists() {
            continue;
        }

        let (plan, email, display_name) = profile_manager::detect_auth_details(&source_dir);
        let _ = profile_manager::get_sqlite_analytics(&source_dir);

        if let Some(plan_value) = plan {
            if profile.plan.as_deref() != Some(plan_value.as_str()) {
                profile.plan = Some(plan_value);
                changed = true;
            }
        }

        if let Some(email_value) = email {
            if profile.email.as_deref() != Some(email_value.as_str()) {
                profile.email = Some(email_value.clone());
                changed = true;
            }
            if profile.name != email_value {
                profile.name = email_value;
                changed = true;
            }
        }

        if let Some(display_name_value) = display_name {
            if profile.display_name.as_deref() != Some(display_name_value.as_str()) {
                profile.display_name = Some(display_name_value);
                changed = true;
            }
        }
    }

    if changed {
        save_config_state(&state)?;
    }

    Ok(state)
}

#[tauri::command]
pub fn save_profile(profile: Profile, clone_active_settings: bool) -> Result<(), String> {
    let mut state = load_config_state();
    
    // Check if profile already exists, if so update it
    let mut exists = false;
    for p in &mut state.profiles {
        if p.id == profile.id {
            p.name = profile.name.clone();
            p.avatar_color = profile.avatar_color.clone();
            p.avatar_emoji = profile.avatar_emoji.clone();
            p.shares_config_with = profile.shares_config_with.clone();
            
            // Auto detect plan/email/display name if auth.json exists
            let profile_dir = get_profiles_dir().join(&profile.id);
            if profile_dir.exists() {
                let (plan, email, display_name) = profile_manager::detect_auth_details(&profile_dir);
                if plan.is_some() { p.plan = plan; }
                if let Some(ref email_val) = email {
                    if p.email.as_ref() != Some(email_val) {
                        p.name = email_val.clone();
                    }
                    p.email = Some(email_val.clone());
                }
                if display_name.is_some() { p.display_name = display_name; }
            }
            
            exists = true;
            break;
        }
    }
    
    if !exists {
        let mut new_profile = profile.clone();
        new_profile.plan = None;
        
        let profile_dir = get_profiles_dir().join(&profile.id);
        fs::create_dir_all(&profile_dir).map_err(|e| e.to_string())?;
        
        if clone_active_settings {
            let active_codex = get_default_codex_dir();
            if active_codex.exists() {
                // Copy non-sensitive configs
                let config_toml = active_codex.join("config.toml");
                if config_toml.exists() {
                    let _ = fs::copy(&config_toml, profile_dir.join("config.toml"));
                }
                let process_mgr = active_codex.join("process_manager");
                if process_mgr.exists() {
                    let _ = copy_dir_all(&process_mgr, profile_dir.join("process_manager"));
                }
                let plugins = active_codex.join("plugins");
                if plugins.exists() {
                    let _ = copy_dir_all(&plugins, profile_dir.join("plugins"));
                }
            }
        }
        
        state.profiles.push(new_profile);
    }
    
    // Handle default profile changes
    if profile.is_default {
        for p in &mut state.profiles {
            p.is_default = p.id == profile.id;
        }
    }
    
    save_config_state(&state)?;
    add_activity_log("Profile Edit", &format!("Saved profile details for: {}", profile.name));
    Ok(())
}

#[tauri::command]
pub fn delete_profile(id: String) -> Result<(), String> {
    let mut state = load_config_state();
    
    // If deleted profile is active, we cannot delete it
    if Some(id.clone()) == state.active_profile_id {
        return Err("Cannot delete the currently active profile. Please switch to another profile first.".to_string());
    }
    
    let mut profile_name = String::new();
    state.profiles.retain(|p| {
        if p.id == id {
            profile_name = p.name.clone();
            false
        } else {
            true
        }
    });
    
    // Delete profile folder
    let profile_dir = get_profiles_dir().join(&id);
    if profile_dir.exists() {
        fs::remove_dir_all(&profile_dir).map_err(|e| format!("Failed to delete profile folder: {}", e))?;
    }
    
    // Delete keychain password associated with this profile if any
    let _ = keychain::delete_password(&id);
    
    save_config_state(&state)?;
    add_activity_log("Profile Delete", &format!("Deleted profile: {} and cleared local credentials.", profile_name));
    Ok(())
}

#[tauri::command]
pub fn switch_profile(target_id: String) -> Result<(), String> {
    // 1. Ensure Codex is closed
    close_codex()?;
    
    let mut state = load_config_state();
    let codex_dir = get_default_codex_dir();
    
    // Find active profile
    let current_active_id = state.active_profile_id.clone();
    
    // 2. Backup currently active profile state
    if let Some(active_id) = current_active_id {
        if codex_dir.exists() {
            let active_profile = state.profiles.iter().find(|p| p.id == active_id);
            let active_profile_dir = get_profiles_dir().join(&active_id);
            
            // Backup credentials of the active profile to its own directory
            let _ = profile_manager::copy_profile_credentials(&codex_dir, &active_profile_dir);
            
            // Backup other configs to active profile's own directory, or shared directory
            let config_dest = if let Some(ref share_id) = active_profile.and_then(|p| p.shares_config_with.as_ref()) {
                get_profiles_dir().join(share_id)
            } else {
                active_profile_dir.clone()
            };
            let _ = profile_manager::copy_profile_configs(&codex_dir, &config_dest);
            
            // Create a historical timestamped backup just in case
            let p_name = active_profile.map(|p| p.name.as_str()).unwrap_or("Unknown");
            let _ = profile_manager::create_backup_dir(&codex_dir, &active_id, p_name);
        }
    }
    
    // 3. Clear active Codex directory
    safe_clear_dir(&codex_dir)?;
    
    // 4. Copy target profile state
    let target_profile = state.profiles.iter().find(|p| p.id == target_id);
    if let Some(t_profile) = target_profile {
        let target_profile_dir = get_profiles_dir().join(&target_id);
        
        // Restore credentials from target profile's own directory
        let _ = profile_manager::copy_profile_credentials(&target_profile_dir, &codex_dir);
        
        // Restore other configs from target profile's own directory, or shared directory
        let config_src = if let Some(ref share_id) = t_profile.shares_config_with {
            get_profiles_dir().join(share_id)
        } else {
            target_profile_dir.clone()
        };
        let _ = profile_manager::copy_profile_configs(&config_src, &codex_dir);
    }
    
    // 5. Update state
    state.active_profile_id = Some(target_id.clone());
    
    // Auto-detect plan and details on target load
    if let Some(target_profile) = state.profiles.iter_mut().find(|p| p.id == target_id) {
        let (plan, email, display_name) = profile_manager::detect_auth_details(&codex_dir);
        if plan.is_some() { target_profile.plan = plan; }
        if let Some(ref email_val) = email {
            if target_profile.email.as_ref() != Some(email_val) {
                target_profile.name = email_val.clone();
            }
            target_profile.email = Some(email_val.clone());
        }
        if display_name.is_some() { target_profile.display_name = display_name; }
    }
    
    save_config_state(&state)?;
    
    let t_name = state.profiles.iter().find(|p| p.id == target_id).map(|p| p.name.as_str()).unwrap_or("Unknown");
    add_activity_log("Profile Switch", &format!("Switched active profile to: {}", t_name));
    
    // 6. Relaunch Codex
    let _ = launch_codex(state.codex_app_path.clone());
    
    Ok(())
}

#[tauri::command]
pub fn get_profile_analytics(
    app_handle: tauri::AppHandle,
    profile_id: String,
    force_refresh: Option<bool>,
) -> Result<ProfileAnalytics, String> {
    let state = load_config_state();
    let is_active = Some(profile_id.clone()) == state.active_profile_id;
    
    let force = force_refresh.unwrap_or(false);
    profile_manager::get_profile_analytics(&app_handle, &profile_id, is_active, force)
}

#[derive(Clone, Serialize)]
struct ProfileRefreshStatePayload {
    profile_id: String,
    refreshing: bool,
}

#[derive(Clone, Serialize)]
struct ProfileAnalyticsUpdatedPayload {
    profile_id: String,
    analytics: ProfileAnalytics,
}

#[tauri::command]
pub async fn refresh_profile(
    app_handle: tauri::AppHandle,
    profile_id: String,
) -> Result<ProfileAnalytics, String> {
    let state = load_config_state();
    let is_active = Some(profile_id.clone()) == state.active_profile_id;
    let app_handle_clone = app_handle.clone();
    let profile_id_clone = profile_id.clone();
    let refresh_set = ACTIVE_PROFILE_REFRESHES.get_or_init(|| Mutex::new(HashSet::new()));

    if let Ok(mut set) = refresh_set.lock() {
        set.insert(profile_id.clone());
    }

    let _ = app_handle.emit("profile-refresh-state", ProfileRefreshStatePayload {
        profile_id: profile_id.clone(),
        refreshing: true,
    });

    let result = tauri::async_runtime::spawn_blocking(move || {
        profile_manager::get_profile_analytics(&app_handle_clone, &profile_id_clone, is_active, true)
    })
    .await
    .map_err(|e| format!("Failed to join profile refresh task: {}", e))?;

    if let Ok(ref analytics) = result {
        let _ = app_handle.emit("profile-analytics-updated", ProfileAnalyticsUpdatedPayload {
            profile_id: profile_id.clone(),
            analytics: analytics.clone(),
        });
    }

    if let Ok(mut set) = refresh_set.lock() {
        set.remove(&profile_id);
    }

    let _ = app_handle.emit("profile-refresh-state", ProfileRefreshStatePayload {
        profile_id: profile_id.clone(),
        refreshing: false,
    });

    result
}

#[tauri::command]
pub fn is_profile_refreshing(profile_id: String) -> Result<bool, String> {
    let refresh_set = ACTIVE_PROFILE_REFRESHES.get_or_init(|| Mutex::new(HashSet::new()));
    let set = refresh_set
        .lock()
        .map_err(|_| "Failed to access refresh state".to_string())?;
    Ok(set.contains(&profile_id))
}

#[tauri::command]
pub fn get_backups() -> Result<Vec<BackupInfo>, String> {
    Ok(profile_manager::get_backups_list())
}

#[tauri::command]
pub fn restore_backup(backup_id: String) -> Result<(), String> {
    close_codex()?;
    
    let backups_dir = profile_manager::get_backups_dir();
    let backup_path = backups_dir.join(&backup_id);
    if !backup_path.exists() {
        return Err("Backup not found".to_string());
    }
    
    let codex_dir = get_default_codex_dir();
    safe_clear_dir(&codex_dir)?;
    
    copy_dir_all(&backup_path, &codex_dir).map_err(|e| format!("Failed to restore backup folder: {}", e))?;
    
    add_activity_log("Backup Restore", &format!("Restored active config from backup: {}", backup_id));
    
    let state = load_config_state();
    let _ = launch_codex(state.codex_app_path.clone());
    
    Ok(())
}

#[tauri::command]
pub fn delete_backup(backup_id: String) -> Result<(), String> {
    let backups_dir = profile_manager::get_backups_dir();
    let backup_path = backups_dir.join(&backup_id);
    if !backup_path.exists() {
        return Err("Backup not found".to_string());
    }

    fs::remove_dir_all(&backup_path)
        .map_err(|e| format!("Failed to delete backup folder: {}", e))?;

    add_activity_log("Backup Delete", &format!("Deleted backup: {}", backup_id));
    Ok(())
}

#[tauri::command]
pub fn panic_reset() -> Result<(), String> {
    // Closes running Codex processes
    let _ = close_codex();
    
    // Wipe keychain passwords for all profiles
    let state = load_config_state();
    for p in &state.profiles {
        let _ = keychain::delete_password(&p.id);
    }
    let _ = keychain::delete_password("app_lock");
    
    // Clear our config directory but do NOT touch ~/.codex so the user keeps current session
    let app_dir = get_app_config_dir();
    if app_dir.exists() {
        fs::remove_dir_all(&app_dir).map_err(|e| format!("Failed to clean app configuration: {}", e))?;
    }
    
    Ok(())
}

#[tauri::command]
pub fn get_activity_logs() -> Result<Vec<LogEntry>, String> {
    let log_path = get_app_config_dir().join("activity_log.json");
    if log_path.exists() {
        if let Ok(content) = fs::read_to_string(&log_path) {
            if let Ok(logs) = serde_json::from_str::<Vec<LogEntry>>(&content) {
                return Ok(logs);
            }
        }
    }
    Ok(Vec::new())
}

#[tauri::command]
pub fn is_app_lock_enabled() -> Result<bool, String> {
    let state = load_config_state();
    Ok(state.app_lock_enabled)
}

#[tauri::command]
pub fn set_app_lock(password: Option<String>) -> Result<(), String> {
    let mut state = load_config_state();
    if let Some(pw) = password {
        keychain::set_password("app_lock", &pw)?;
        state.app_lock_enabled = true;
        add_activity_log("Security Settings", "App Lock has been enabled.");
    } else {
        let _ = keychain::delete_password("app_lock");
        state.app_lock_enabled = false;
        add_activity_log("Security Settings", "App Lock has been disabled.");
    }
    save_config_state(&state)?;
    Ok(())
}

#[tauri::command]
pub fn verify_app_lock(password: String) -> Result<bool, String> {
    if let Ok(saved) = keychain::get_password("app_lock") {
        Ok(saved == password)
    } else {
        Err("Passcode is not configured.".to_string())
    }
}

#[tauri::command]
pub fn set_codex_app_path(path: Option<String>) -> Result<(), String> {
    let mut state = load_config_state();
    state.codex_app_path = path.clone();
    save_config_state(&state)?;
    if let Some(ref p) = path {
        add_activity_log("Settings Edit", &format!("Configured Codex application path to: {}", p));
    } else {
        add_activity_log("Settings Edit", "Reset Codex application path to default auto-detection.");
    }
    Ok(())
}

#[tauri::command]
pub fn get_detected_codex_app_path() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let default_path = "/Applications/Codex.app";
        if Path::new(default_path).exists() {
            return Ok(default_path.to_string());
        }
        return Ok(default_path.to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let p1 = Path::new(&local_appdata).join("Programs").join("Codex").join("Codex.exe");
        if p1.exists() {
            return Ok(p1.to_string_lossy().to_string());
        }

        let program_files = std::env::var("ProgramFiles").unwrap_or_default();
        let p2 = Path::new(&program_files).join("Codex").join("Codex.exe");
        return Ok(p2.to_string_lossy().to_string());
    }

    #[cfg(target_os = "linux")]
    {
        Ok(String::new())
    }
}

#[tauri::command]
pub fn get_system_os_label() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let version = Command::new("sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Unknown".to_string());
        return Ok(format!("macOS {}", version));
    }

    #[cfg(target_os = "windows")]
    {
        let product_name = Command::new("reg")
            .args(["query", r#"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion"#, "/v", "ProductName"])
            .output()
            .ok()
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .and_then(|stdout| {
                stdout
                    .lines()
                    .find(|line| line.contains("ProductName"))
                    .and_then(|line| line.split_whitespace().last())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| "Windows".to_string());

        let display_version = Command::new("reg")
            .args(["query", r#"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion"#, "/v", "DisplayVersion"])
            .output()
            .ok()
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .and_then(|stdout| {
                stdout
                    .lines()
                    .find(|line| line.contains("DisplayVersion"))
                    .and_then(|line| line.split_whitespace().last())
                    .map(|s| s.to_string())
            })
            .unwrap_or_default();

        return Ok(if display_version.is_empty() {
            product_name
        } else {
            format!("{} {}", product_name, display_version)
        });
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(contents) = fs::read_to_string("/etc/os-release") {
            if let Some(pretty_name) = contents
                .lines()
                .find(|line| line.starts_with("PRETTY_NAME="))
                .map(|line| line.trim_start_matches("PRETTY_NAME=").trim_matches('"').to_string())
            {
                return Ok(pretty_name);
            }
        }
        return Ok("Linux".to_string());
    }
}

#[tauri::command]
pub fn get_app_config_dir_path() -> Result<String, String> {
    let path = get_app_config_dir();
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_app_config_dir() -> Result<(), String> {
    let path = get_app_config_dir();
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
