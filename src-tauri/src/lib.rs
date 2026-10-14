use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Google sign-in returns through a repeaternation-feed:// link. On Windows and Linux that launches a
    // second process, so single-instance (with its deep-link feature) hands the link to the running app and
    // brings its window forward. It must come before the deep-link plugin.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));
    }

    builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init());

    // AppImages and dev builds have no installer to register the link type, so do it at runtime.
    #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
    {
        builder = builder.setup(|app| {
            use tauri_plugin_deep_link::DeepLinkExt;
            let _ = app.deep_link().register_all();
            Ok(())
        });
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running the feed app");
}
