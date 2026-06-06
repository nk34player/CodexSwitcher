use std::fs;
use std::path::{Path, PathBuf};
use serde::{Serialize, Deserialize};
use chrono::{Utc, Local};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD, engine::general_purpose::STANDARD};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tauri::Emitter;

static RATE_LIMIT_CACHE: OnceLock<Mutex<HashMap<String, (Option<CodexUsageResponse>, Instant)>>> = OnceLock::new();
static CONFIG_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();


#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub plan: Option<String>,
    pub avatar_color: String,
    pub avatar_emoji: String,
    pub is_default: bool,
    #[serde(default)]
    pub shares_config_with: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigState {
    pub active_profile_id: Option<String>,
    pub codex_app_path: Option<String>,
    pub profiles: Vec<Profile>,
    pub app_lock_enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodexRateLimitWindow {
    pub used_percent: u32,
    pub limit_window_seconds: u32,
    pub reset_after_seconds: u32,
    pub reset_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodexRateLimit {
    pub allowed: bool,
    pub limit_reached: bool,
    pub primary_window: Option<CodexRateLimitWindow>,
    pub secondary_window: Option<CodexRateLimitWindow>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodexUsageResponse {
    pub email: Option<String>,
    pub plan_type: Option<String>,
    pub rate_limit: Option<CodexRateLimit>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ProfileAnalytics {
    pub plan: String,
    pub email: String,
    pub name: String,
    pub daily_requests: u32,
    pub weekly_requests: u32,
    pub total_threads: u32,
    pub total_agent_jobs: u32,
    pub live_primary_used_percent: Option<u32>,
    pub live_primary_reset_at: Option<i64>,
    pub live_secondary_used_percent: Option<u32>,
    pub live_secondary_reset_at: Option<i64>,
}


#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BackupInfo {
    pub id: String,
    pub timestamp: String,
    pub profile_id: String,
    pub profile_name: String,
    pub path: String,
    pub size_bytes: u64,
}

// Get the app config directory: ~/.config/codex-switcher/
pub fn get_app_config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("codex-switcher")
}

// Get the default Codex home directory: ~/.codex/
pub fn get_default_codex_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".codex")
}

// Get profiles config path: ~/.config/codex-switcher/config.json
pub fn get_config_path() -> PathBuf {
    get_app_config_dir().join("config.json")
}

// Get directory for storing profiles: ~/.config/codex-switcher/profiles/
pub fn get_profiles_dir() -> PathBuf {
    get_app_config_dir().join("profiles")
}

// Get directory for backups: ~/.config/codex-switcher/backups/
pub fn get_backups_dir() -> PathBuf {
    get_app_config_dir().join("backups")
}

fn dir_size_bytes(path: &Path) -> u64 {
    let mut total = 0_u64;

    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_dir() {
                    total = total.saturating_add(dir_size_bytes(&entry_path));
                } else if file_type.is_file() {
                    if let Ok(metadata) = entry.metadata() {
                        total = total.saturating_add(metadata.len());
                    }
                }
            }
        }
    }

    total
}


// Recursively copy directory, resiliently skipping locked files and lock configurations
pub fn copy_dir_all(src: impl AsRef<Path>, dst: impl AsRef<Path>) -> std::io::Result<()> {
    let src_ref = src.as_ref();
    let dst_ref = dst.as_ref();
    fs::create_dir_all(dst_ref)?;
    
    if let Ok(entries) = fs::read_dir(src_ref) {
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let file_name_str = file_name.to_string_lossy();
            
            // Skip locks, temporary files, and socket pipe folders
            if file_name_str.ends_with("-shm") 
                || file_name_str.ends_with("-wal") 
                || file_name_str == ".tmp" 
                || file_name_str == "process_manager" 
            {
                continue;
            }
            
            let src_path = entry.path();
            let dst_path = dst_ref.join(&file_name);
            
            if let Ok(ty) = entry.file_type() {
                if ty.is_dir() {
                    let _ = copy_dir_all(&src_path, &dst_path);
                } else if ty.is_file() {
                    let _ = fs::copy(&src_path, &dst_path);
                }
            }
        }
    }
    Ok(())
}

// Copy only credentials (auth.json)
pub fn copy_profile_credentials(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    let src_auth = src.join("auth.json");
    if src_auth.exists() {
        fs::copy(&src_auth, dst.join("auth.json"))?;
    }
    Ok(())
}

// Copy everything EXCEPT credentials (auth.json)
pub fn copy_profile_configs(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    if let Ok(entries) = fs::read_dir(src) {
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let file_name_str = file_name.to_string_lossy();
            
            // Skip credentials (auth.json)
            if file_name_str == "auth.json" {
                continue;
            }
            
            // Skip locks, temporary files, and socket pipe folders
            if file_name_str.ends_with("-shm") 
                || file_name_str.ends_with("-wal") 
                || file_name_str == ".tmp" 
                || file_name_str == "process_manager" 
            {
                continue;
            }
            
            let src_path = entry.path();
            let dst_path = dst.join(&file_name);
            
            if let Ok(ty) = entry.file_type() {
                if ty.is_dir() {
                    let _ = copy_dir_all(&src_path, &dst_path);
                } else if ty.is_file() {
                    let _ = fs::copy(&src_path, &dst_path);
                }
            }
        }
    }
    Ok(())
}

// Safely clear directory contents
pub fn safe_clear_dir(path: &Path) -> Result<(), String> {
    let path_str = path.to_string_lossy().to_string();
    if !path_str.contains(".codex") && !path_str.contains("codex-switcher") {
        return Err("Safety check failed: Refusing to delete non-Codex directory".to_string());
    }
    if path.exists() {
        fs::remove_dir_all(path).map_err(|e| format!("Failed to remove directory: {}", e))?;
    }
    fs::create_dir_all(path).map_err(|e| format!("Failed to create directory: {}", e))?;
    Ok(())
}

fn load_config_state_impl() -> ConfigState {
    let path = get_config_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(state) = serde_json::from_str::<ConfigState>(&content) {
                return state;
            }
        }
    }
    
    // Return default state if file doesn't exist or is invalid
    ConfigState {
        active_profile_id: None,
        codex_app_path: None,
        profiles: Vec::new(),
        app_lock_enabled: false,
    }
}

fn save_config_state_impl(state: &ConfigState) -> Result<(), String> {
    let dir = get_app_config_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let content = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(get_config_path(), content).map_err(|e| e.to_string())?;
    Ok(())
}

// Load configurations from config.json
pub fn load_config_state() -> ConfigState {
    let mutex = CONFIG_MUTEX.get_or_init(|| Mutex::new(()));
    let _guard = mutex.lock().unwrap();
    load_config_state_impl()
}

// Save config state to config.json
pub fn save_config_state(state: &ConfigState) -> Result<(), String> {
    let mutex = CONFIG_MUTEX.get_or_init(|| Mutex::new(()));
    let _guard = mutex.lock().unwrap();
    save_config_state_impl(state)
}

pub fn update_profile_metadata_thread_safe(profile_id: &str, analytics: &ProfileAnalytics) {
    let mutex = CONFIG_MUTEX.get_or_init(|| Mutex::new(()));
    let _guard = mutex.lock().unwrap();
    
    let state = load_config_state_impl();
    let mut updated = false;
    let mut current_state = state;
    for p in &mut current_state.profiles {
        if p.id == profile_id {
            if p.plan.as_deref() != Some(&analytics.plan) {
                p.plan = Some(analytics.plan.clone());
                updated = true;
            }
            if !analytics.email.is_empty() && (p.email.as_deref() != Some(&analytics.email) || p.name != analytics.email) {
                p.email = Some(analytics.email.clone());
                p.name = analytics.email.clone();
                updated = true;
            }
            if !analytics.name.is_empty() && p.display_name.as_deref() != Some(&analytics.name) {
                p.display_name = Some(analytics.name.clone());
                updated = true;
            }
            break;
        }
    }
    
    if updated {
        let _ = save_config_state_impl(&current_state);
    }
}

// Decode JWT token payload
fn decode_jwt_payload(token: &str) -> Option<serde_json::Value> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 {
        return None;
    }
    let payload_b64 = parts[1];
    
    // Base64 padding
    let mut padded = payload_b64.to_string();
    while padded.len() % 4 != 0 {
        padded.push('=');
    }
    
    if let Ok(decoded) = URL_SAFE_NO_PAD.decode(payload_b64) {
        if let Ok(json_str) = String::from_utf8(decoded) {
            if let Ok(val) = serde_json::from_str(&json_str) {
                return Some(val);
            }
        }
    }
    
    if let Ok(decoded) = STANDARD.decode(&padded) {
        if let Ok(json_str) = String::from_utf8(decoded) {
            if let Ok(val) = serde_json::from_str(&json_str) {
                return Some(val);
            }
        }
    }
    None
}

// Auto-detect plan and profile details from auth.json
pub fn detect_auth_details(codex_dir: &Path) -> (Option<String>, Option<String>, Option<String>) {
    let auth_path = codex_dir.join("auth.json");
    if !auth_path.exists() {
        return (None, None, None);
    }
    
    let mut email = None;
    let mut name = None;
    let mut plan = None;
    
    if let Ok(content) = fs::read_to_string(auth_path) {
        if let Ok(auth_data) = serde_json::from_str::<serde_json::Value>(&content) {
            // Check tokens
            if let Some(tokens) = auth_data.get("tokens") {
                // Parse access_token for plan and profile email
                if let Some(access_token_val) = tokens.get("access_token").and_then(|t| t.as_str()) {
                    if let Some(payload) = decode_jwt_payload(access_token_val) {
                        // Plan detection
                        if let Some(auth_claim) = payload.get("https://api.openai.com/auth") {
                            if let Some(plan_type) = auth_claim.get("chatgpt_plan_type").and_then(|p| p.as_str()) {
                                plan = Some(plan_type.to_string());
                            }
                        }
                        // Email detection (profile claim)
                        if let Some(profile_claim) = payload.get("https://api.openai.com/profile") {
                            if let Some(email_val) = profile_claim.get("email").and_then(|e| e.as_str()) {
                                email = Some(email_val.to_string());
                            }
                        }
                    }
                }
                
                // Parse id_token for email and name
                if let Some(id_token_val) = tokens.get("id_token").and_then(|t| t.as_str()) {
                    if let Some(payload) = decode_jwt_payload(id_token_val) {
                        if email.is_none() {
                            if let Some(email_val) = payload.get("email").and_then(|e| e.as_str()) {
                                email = Some(email_val.to_string());
                            }
                        }
                        if let Some(name_val) = payload.get("name").and_then(|n| n.as_str()) {
                            name = Some(name_val.to_string());
                        }
                    }
                }
            }
        }
    }
    (plan, email, name)
}

// The actual blocking fetch operation
pub fn fetch_live_rate_limits_backend(_profile_id: &str, codex_dir: &Path) -> Option<CodexUsageResponse> {
    let auth_path = codex_dir.join("auth.json");
    if !auth_path.exists() {
        return None;
    }
    
    let content = fs::read_to_string(auth_path).ok()?;
    let auth_data: serde_json::Value = serde_json::from_str(&content).ok()?;
    let access_token = auth_data.get("tokens")
        .and_then(|t| t.get("access_token"))
        .and_then(|t| t.as_str())?;
        
    // Fast 2-second timeout to prevent UI thread blocking in case of slow connection/offline status
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .ok()?;
        
    let mut res = client.get("https://chatgpt.com/backend-api/codex/usage")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Content-Type", "application/json")
        .send()
        .ok();
        
    // Fallback to wham/usage
    if res.as_ref().map_or(true, |r| !r.status().is_success()) {
        res = client.get("https://chatgpt.com/backend-api/wham/usage")
            .header("Authorization", format!("Bearer {}", access_token))
            .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .header("Content-Type", "application/json")
            .send()
            .ok();
    }
        
    if let Some(r) = res {
        if r.status().is_success() {
            if let Ok(usage_res) = r.json::<CodexUsageResponse>() {
                return Some(usage_res);
            }
        }
    }
    
    None
}

// Fetch live rate limits from OpenAI backend (with global memory caching to prevent lag)
pub fn fetch_live_rate_limits(profile_id: &str, codex_dir: &Path) -> Option<CodexUsageResponse> {
    // 1. Check local memory cache
    let cache = RATE_LIMIT_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(map) = cache.lock() {
        if let Some((cached_result, instant)) = map.get(profile_id) {
            // Cache TTL: 60 seconds
            if instant.elapsed().as_secs() < 60 {
                return cached_result.clone();
            }
        }
    }

    let final_result = fetch_live_rate_limits_backend(profile_id, codex_dir);
    
    // Save output (success or failure) to local cache
    if let Ok(mut map) = cache.lock() {
        map.insert(profile_id.to_string(), (final_result.clone(), Instant::now()));
    }
    
    final_result
}



// Parse SQLite local analytics
pub fn get_sqlite_analytics(codex_dir: &Path) -> (u32, u32, u32, u32) {
    let logs_db = codex_dir.join("logs_2.sqlite");
    let state_db = codex_dir.join("state_5.sqlite");
    
    let mut daily_requests = 0;
    let mut weekly_requests = 0;
    let mut total_threads = 0;
    let mut total_agent_jobs = 0;
    
    let now_sec = Utc::now().timestamp();
    let one_day_ago = now_sec - 86400;
    let one_week_ago = now_sec - 86400 * 7;
    
    // Query logs database
    if logs_db.exists() {
        // Open read-only to avoid file locks
        if let Ok(conn) = rusqlite::Connection::open_with_flags(
            &logs_db,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        ) {
            // Count daily logs (ts is milliseconds)
            let daily_query = "SELECT COUNT(*) FROM logs WHERE ts >= ?1";
            if let Ok(count) = conn.query_row(daily_query, [one_day_ago * 1000], |row| row.get::<_, u32>(0)) {
                daily_requests = count;
            }
            
            // Count weekly logs
            let weekly_query = "SELECT COUNT(*) FROM logs WHERE ts >= ?1";
            if let Ok(count) = conn.query_row(weekly_query, [one_week_ago * 1000], |row| row.get::<_, u32>(0)) {
                weekly_requests = count;
            }
        }
    }
    
    // Query state database
    if state_db.exists() {
        if let Ok(conn) = rusqlite::Connection::open_with_flags(
            &state_db,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        ) {
            // Count threads
            if let Ok(count) = conn.query_row("SELECT COUNT(*) FROM threads", [], |row| row.get::<_, u32>(0)) {
                total_threads = count;
            }
            
            // Count agent jobs
            if let Ok(count) = conn.query_row("SELECT COUNT(*) FROM agent_jobs", [], |row| row.get::<_, u32>(0)) {
                total_agent_jobs = count;
            }
        }
    }
    
    (daily_requests, weekly_requests, total_threads, total_agent_jobs)
}

// Compile complete profile analytics (with SWR caching to eliminate navigation lag)
pub fn get_profile_analytics(
    app_handle: &tauri::AppHandle,
    profile_id: &str,
    is_active: bool,
    force_refresh: bool,
) -> Result<ProfileAnalytics, String> {
    let codex_dir = if is_active {
        get_default_codex_dir()
    } else {
        get_profiles_dir().join(profile_id)
    };

    if force_refresh {
        // Clear cache
        let cache = RATE_LIMIT_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
        if let Ok(mut map) = cache.lock() {
            map.remove(profile_id);
        }
        
        // Fetch synchronously
        let (mut plan_opt, email_opt, name_opt) = detect_auth_details(&codex_dir);
        let (daily, weekly, threads, jobs) = get_sqlite_analytics(&codex_dir);
        
        let mut live_primary_used_percent = None;
        let mut live_primary_reset_at = None;
        let mut live_secondary_used_percent = None;
        let mut live_secondary_reset_at = None;
        
        if let Some(usage_res) = fetch_live_rate_limits(profile_id, &codex_dir) {
            if let Some(plan_type) = usage_res.plan_type {
                plan_opt = Some(plan_type);
            }
            if let Some(rate_limit) = usage_res.rate_limit {
                if let Some(pw) = rate_limit.primary_window {
                    live_primary_used_percent = Some(pw.used_percent);
                    live_primary_reset_at = Some(pw.reset_at);
                }
                if let Some(sw) = rate_limit.secondary_window {
                    live_secondary_used_percent = Some(sw.used_percent);
                    live_secondary_reset_at = Some(sw.reset_at);
                }
            }
        }
        
        let analytics = ProfileAnalytics {
            plan: plan_opt.unwrap_or_else(|| "free".to_string()),
            email: email_opt.unwrap_or_else(|| "".to_string()),
            name: name_opt.unwrap_or_else(|| "".to_string()),
            daily_requests: daily,
            weekly_requests: weekly,
            total_threads: threads,
            total_agent_jobs: jobs,
            live_primary_used_percent,
            live_primary_reset_at,
            live_secondary_used_percent,
            live_secondary_reset_at,
        };

        update_profile_metadata_thread_safe(profile_id, &analytics);
        return Ok(analytics);
    }

    // Standard path (SWR)
    let (cache_val, is_expired) = {
        let cache = RATE_LIMIT_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
        if let Ok(map) = cache.lock() {
            if let Some((cached_result, instant)) = map.get(profile_id) {
                (Some(cached_result.clone()), instant.elapsed().as_secs() >= 60)
            } else {
                (None, true)
            }
        } else {
            (None, true)
        }
    };

    // If cache is valid and not expired, return immediately
    if let Some(usage_opt) = cache_val.clone() {
        if !is_expired {
            let (mut plan_opt, email_opt, name_opt) = detect_auth_details(&codex_dir);
            let (daily, weekly, threads, jobs) = get_sqlite_analytics(&codex_dir);
            let mut live_primary_used_percent = None;
            let mut live_primary_reset_at = None;
            let mut live_secondary_used_percent = None;
            let mut live_secondary_reset_at = None;
            
            if let Some(usage_res) = usage_opt {
                if let Some(plan_type) = usage_res.plan_type {
                    plan_opt = Some(plan_type);
                }
                if let Some(rate_limit) = usage_res.rate_limit {
                    if let Some(pw) = rate_limit.primary_window {
                        live_primary_used_percent = Some(pw.used_percent);
                        live_primary_reset_at = Some(pw.reset_at);
                    }
                    if let Some(sw) = rate_limit.secondary_window {
                        live_secondary_used_percent = Some(sw.used_percent);
                        live_secondary_reset_at = Some(sw.reset_at);
                    }
                }
            }
            return Ok(ProfileAnalytics {
                plan: plan_opt.unwrap_or_else(|| "free".to_string()),
                email: email_opt.unwrap_or_else(|| "".to_string()),
                name: name_opt.unwrap_or_else(|| "".to_string()),
                daily_requests: daily,
                weekly_requests: weekly,
                total_threads: threads,
                total_agent_jobs: jobs,
                live_primary_used_percent,
                live_primary_reset_at,
                live_secondary_used_percent,
                live_secondary_reset_at,
            });
        }
    }

    // Cache is expired or missing. We must trigger a background update thread, but return stale/fallback results immediately.
    let p_id_clone = profile_id.to_string();
    let app_handle_clone = app_handle.clone();
    
    // Spawn background thread to fetch
    std::thread::spawn(move || {
        // 1. Fetch live rate limits
        let target_dir = if is_active {
            get_default_codex_dir()
        } else {
            get_profiles_dir().join(&p_id_clone)
        };
        
        let live_res = fetch_live_rate_limits_backend(&p_id_clone, &target_dir);
        
        // 2. Put into cache
        let cache = RATE_LIMIT_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
        if let Ok(mut map) = cache.lock() {
            map.insert(p_id_clone.clone(), (live_res.clone(), Instant::now()));
        }
        
        // 3. Compile full profile analytics for event payload
        let (mut plan_opt, email_opt, name_opt) = detect_auth_details(&target_dir);
        let (daily, weekly, threads, jobs) = get_sqlite_analytics(&target_dir);
        
        let mut live_primary_used_percent = None;
        let mut live_primary_reset_at = None;
        let mut live_secondary_used_percent = None;
        let mut live_secondary_reset_at = None;
        
        if let Some(ref usage_res) = live_res {
            if let Some(ref plan_type) = usage_res.plan_type {
                plan_opt = Some(plan_type.clone());
            }
            if let Some(ref rate_limit) = usage_res.rate_limit {
                if let Some(ref pw) = rate_limit.primary_window {
                    live_primary_used_percent = Some(pw.used_percent);
                    live_primary_reset_at = Some(pw.reset_at);
                }
                if let Some(ref sw) = rate_limit.secondary_window {
                    live_secondary_used_percent = Some(sw.used_percent);
                    live_secondary_reset_at = Some(sw.reset_at);
                }
            }
        }
        
        let analytics = ProfileAnalytics {
            plan: plan_opt.unwrap_or_else(|| "free".to_string()),
            email: email_opt.unwrap_or_else(|| "".to_string()),
            name: name_opt.unwrap_or_else(|| "".to_string()),
            daily_requests: daily,
            weekly_requests: weekly,
            total_threads: threads,
            total_agent_jobs: jobs,
            live_primary_used_percent,
            live_primary_reset_at,
            live_secondary_used_percent,
            live_secondary_reset_at,
        };
        
        // 4. Update the profile metadata in config.json if needed
        update_profile_metadata_thread_safe(&p_id_clone, &analytics);
        
        // 5. Emit event to frontend
        #[derive(Clone, Serialize)]
        struct Payload {
            profile_id: String,
            analytics: ProfileAnalytics,
        }
        let _ = app_handle_clone.emit("profile-analytics-updated", Payload {
            profile_id: p_id_clone,
            analytics,
        });
    });

    // Return stale cache value or fallback immediately (no blocking!)
    let (mut plan_opt, email_opt, name_opt) = detect_auth_details(&codex_dir);
    let (daily, weekly, threads, jobs) = get_sqlite_analytics(&codex_dir);
    
    let mut live_primary_used_percent = None;
    let mut live_primary_reset_at = None;
    let mut live_secondary_used_percent = None;
    let mut live_secondary_reset_at = None;
    
    if let Some(Some(ref usage_res)) = cache_val {
        if let Some(ref plan_type) = usage_res.plan_type {
            plan_opt = Some(plan_type.clone());
        }
        if let Some(ref rate_limit) = usage_res.rate_limit {
            if let Some(ref pw) = rate_limit.primary_window {
                live_primary_used_percent = Some(pw.used_percent);
                live_primary_reset_at = Some(pw.reset_at);
            }
            if let Some(ref sw) = rate_limit.secondary_window {
                live_secondary_used_percent = Some(sw.used_percent);
                live_secondary_reset_at = Some(sw.reset_at);
            }
        }
    }

    Ok(ProfileAnalytics {
        plan: plan_opt.unwrap_or_else(|| "free".to_string()),
        email: email_opt.unwrap_or_else(|| "".to_string()),
        name: name_opt.unwrap_or_else(|| "".to_string()),
        daily_requests: daily,
        weekly_requests: weekly,
        total_threads: threads,
        total_agent_jobs: jobs,
        live_primary_used_percent,
        live_primary_reset_at,
        live_secondary_used_percent,
        live_secondary_reset_at,
    })
}


// Create a backup of target directory
pub fn create_backup_dir(codex_dir: &Path, profile_id: &str, profile_name: &str) -> Result<BackupInfo, String> {
    let backups_dir = get_backups_dir();
    fs::create_dir_all(&backups_dir).map_err(|e| e.to_string())?;
    
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let backup_id = format!("{}_{}", timestamp, profile_id);
    let backup_path = backups_dir.join(&backup_id);
    
    if codex_dir.exists() {
        copy_dir_all(codex_dir, &backup_path).map_err(|e| format!("Backup copy failed: {}", e))?;
    } else {
        fs::create_dir_all(&backup_path).map_err(|e| e.to_string())?;
    }
    
    Ok(BackupInfo {
        id: backup_id,
        timestamp: Utc::now().to_rfc3339(),
        profile_id: profile_id.to_string(),
        profile_name: profile_name.to_string(),
        path: backup_path.to_string_lossy().to_string(),
        size_bytes: dir_size_bytes(&backup_path),
    })
}

// Get list of available backups
pub fn get_backups_list() -> Vec<BackupInfo> {
    let backups_dir = get_backups_dir();
    let mut backups = Vec::new();
    if !backups_dir.exists() {
        return backups;
    }
    
    if let Ok(entries) = fs::read_dir(backups_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                let parts: Vec<&str> = name.split('_').collect();
                if parts.len() >= 3 {
                    let profile_id = parts[2..].join("_");
                    
                    // We can load details from profile list or construct basic info
                    let timestamp_dt = Local::now().to_rfc3339(); // fallback
                    backups.push(BackupInfo {
                        id: name.clone(),
                        timestamp: timestamp_dt,
                        profile_id,
                        profile_name: "Backup".to_string(),
                        path: path.to_string_lossy().to_string(),
                        size_bytes: dir_size_bytes(&path),
                    });
                }
            }
        }
    }
    backups
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_path_resolution() {
        let app_config = get_app_config_dir();
        assert!(app_config.to_string_lossy().contains("codex-switcher"));
        
        let config_path = get_config_path();
        assert!(config_path.to_string_lossy().contains("config.json"));
    }

    #[test]
    fn test_jwt_decoding() {
        // Mock payload part for {"chatgpt_plan_type": "plus", "email": "dev@openai.com"}
        let token = "header.eyJjaGF0Z3B0X3BsYW5fdHlwZSI6ICJwbHVzIiwgImVtYWlsIjogImRldkBvcGVuYWkuY29tIn0.signature";
        let payload = decode_jwt_payload(token);
        assert!(payload.is_some());
        let val = payload.unwrap();
        assert_eq!(val.get("chatgpt_plan_type").and_then(|v| v.as_str()), Some("plus"));
        assert_eq!(val.get("email").and_then(|v| v.as_str()), Some("dev@openai.com"));
    }

    #[test]
    fn test_deserialization() {
        let json_data = r#"{
            "user_id": "user-123",
            "account_id": "account-123",
            "email": "test@example.com",
            "plan_type": "plus",
            "rate_limit": {
                "allowed": true,
                "limit_reached": false,
                "primary_window": {
                    "used_percent": 98,
                    "limit_window_seconds": 18000,
                    "reset_after_seconds": 597,
                    "reset_at": 1780654383
                },
                "secondary_window": {
                    "used_percent": 43,
                    "limit_window_seconds": 604800,
                    "reset_after_seconds": 498976,
                    "reset_at": 1781152761
                }
            }
        }"#;
        let parsed: Result<CodexUsageResponse, _> = serde_json::from_str(json_data);
        assert!(parsed.is_ok());
        let response = parsed.unwrap();
        assert_eq!(response.email.as_deref(), Some("test@example.com"));
        assert_eq!(response.plan_type.as_deref(), Some("plus"));
        let rate_limit = response.rate_limit.unwrap();
        assert!(rate_limit.allowed);
        let primary = rate_limit.primary_window.unwrap();
        assert_eq!(primary.used_percent, 98);
        assert_eq!(primary.reset_at, 1780654383);
    }
}
