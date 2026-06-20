use tauri::menu::MenuBuilder;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, Window, WindowEvent};

use crate::state::AppState;

/// Builds the system-tray icon + menu. Left-click restores the window; the
/// menu (right-click on Windows) offers Open and a real Quit.
pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text("open", "Open GitDesktop")
        .separator()
        .text("quit", "Quit")
        .build()?;

    let mut builder = TrayIconBuilder::new()
        .tooltip("GitDesktop")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// On window close, hide to the tray (keeping the app — and any in-flight
/// review — running) when the user's "close to tray" preference is on. When
/// it's off, the close proceeds and the app quits (it's the only window). The
/// tray "Quit" bypasses this entirely via `app.exit`.
pub fn handle_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.state::<AppState>().close_to_tray() {
            let _ = window.hide();
            api.prevent_close();
        } else {
            // No tray-resident lifetime wanted — quit explicitly rather than
            // rely on last-window-closed auto-exit (a tray icon can keep the
            // event loop alive).
            window.app_handle().exit(0);
        }
    }
}

/// Mirrors the frontend's "close to tray" setting into the backend, which owns
/// the window-close decision.
#[tauri::command]
pub fn set_close_to_tray(state: State<AppState>, enabled: bool) {
    state.set_close_to_tray(enabled);
}
