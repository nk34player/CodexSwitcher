mod keychain;
mod profile_manager;
mod commands;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.center();
                let _ = window.show();
                let _ = window.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::check_codex_status,
            commands::close_codex,
            commands::launch_codex,
            commands::get_profiles,
            commands::hydrate_boot_state,
            commands::save_profile,
            commands::delete_profile,
            commands::switch_profile,
            commands::get_profile_analytics,
            commands::refresh_profile,
            commands::is_profile_refreshing,
            commands::get_backups,
            commands::restore_backup,
            commands::delete_backup,
            commands::panic_reset,
            commands::get_activity_logs,
            commands::is_app_lock_enabled,
            commands::set_app_lock,
            commands::verify_app_lock,
            commands::set_codex_app_path,
            commands::get_detected_codex_app_path,
            commands::get_system_os_label,
            commands::get_app_config_dir_path,
            commands::open_app_config_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
