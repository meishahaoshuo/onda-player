use serde::Serialize;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::UNIX_EPOCH;
use tauri::{Manager, Emitter};

/**
 * 原生文件接入（桌面端，docs/02「桌面端重要说明」）：
 *  - media:// 协议：按 Range 流式返回音频文件，audio.src 直接指向协议 URL，
 *    整文件不进内存；seek 由浏览器的分段 Range 请求驱动
 *  - list_audio_files：递归枚举音频（跳过隐藏目录），返回 path/size/mtime
 *  - read_head：读文件头部若干字节（标签解析用），经 tauri::ipc::Response 走
 *    二进制通道（JSON 数组通道对 MB 级字节太慢）
 *  - read_text_file：读 .lrc 等文本
 *
 * 桌面特性（9.5）：无边框窗口 + Acrylic 磨砂（set_window_effect 随主题调 tint）、
 * 托盘（左键唤窗，菜单控制播放；事件 emit 给前端转发到 player store）、
 * 关闭即隐藏到托盘（退出走托盘菜单）、单实例锁（二次启动唤起已有窗口）。
 */

const AUDIO_EXTS: &[&str] = &["mp3", "flac", "ogg", "oga", "opus", "wav", "m4a", "aac", "webm", "wma"];

/// media:// 无 Range 或开区间 Range 时单次返回的最大字节数；
/// 浏览器会依据 Content-Range 总长自行发起后续 Range 请求
const STREAM_CHUNK: u64 = 4 * 1024 * 1024;

#[derive(Serialize)]
pub struct AudioEntry {
  pub abs: String,
  pub rel: String,
  pub size: u64,
  pub mtime_ms: u64,
}

fn walk(dir: &Path, root: &Path, out: &mut Vec<AudioEntry>) {
  let Ok(rd) = std::fs::read_dir(dir) else { return };
  for entry in rd.flatten() {
    let name = entry.file_name().to_string_lossy().to_string();
    if name.starts_with('.') {
      continue;
    }
    let p = entry.path();
    let Ok(ft) = entry.file_type() else { continue };
    if ft.is_dir() {
      walk(&p, root, out);
      continue;
    }
    let ext = p
      .extension()
      .and_then(|e| e.to_str())
      .map(|e| e.to_lowercase())
      .unwrap_or_default();
    if !AUDIO_EXTS.contains(&ext.as_str()) {
      continue;
    }
    let Ok(meta) = entry.metadata() else { continue };
    let rel = p
      .strip_prefix(root)
      .unwrap_or(&p)
      .to_string_lossy()
      .replace('\\', "/");
    let mtime_ms = meta
      .modified()
      .ok()
      .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
      .map(|d| d.as_millis() as u64)
      .unwrap_or(0);
    out.push(AudioEntry {
      abs: p.to_string_lossy().to_string(),
      rel,
      size: meta.len(),
      mtime_ms,
    });
  }
}

#[tauri::command]
fn list_audio_files(dir: String) -> Result<Vec<AudioEntry>, String> {
  let root = PathBuf::from(&dir);
  if !root.is_dir() {
    return Err(format!("目录不存在：{}", dir));
  }
  let mut out = Vec::new();
  walk(&root, &root, &mut out);
  out.sort_by(|a, b| a.rel.cmp(&b.rel));
  Ok(out)
}

#[tauri::command]
fn read_head(path: String, max_len: Option<u64>) -> Result<tauri::ipc::Response, String> {
  let n = max_len.unwrap_or(2 * 1024 * 1024);
  let f = std::fs::File::open(&path).map_err(|e| e.to_string())?;
  let mut buf = Vec::with_capacity(1024 * 1024);
  f.take(n).read_to_end(&mut buf).map_err(|e| e.to_string())?;
  Ok(tauri::ipc::Response::new(buf))
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
  std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// 窗口磨砂：按主题 tint 的 Acrylic（深色深灰、浅色浅灰）。
/// 切主题时前端会重调；失败（不支持的系统）静默降级为不透明背景。
#[tauri::command]
fn set_window_effect(window: tauri::WebviewWindow, dark: bool) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  {
    let _ = window_vibrancy::clear_acrylic(&window);
    let _ = window_vibrancy::clear_mica(&window);
    let tint = if dark { (14, 14, 18, 125) } else { (242, 243, 245, 150) };
    window_vibrancy::apply_acrylic(&window, Some(tint)).map_err(|e| e.to_string())
  }
  #[cfg(not(target_os = "windows"))]
  {
    let _ = (window, dark);
    Ok(())
  }
}

fn show_main_window(app: &tauri::AppHandle) {
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
  }
}

/// 前端是否已完成窗口预定位（`primeWindow` 成功后回执置位）。
/// 兜底线程据此区分「窗口还没被前端显示」与「窗口已被用户收起」。
static WINDOW_PRIMED: AtomicBool = AtomicBool::new(false);

/// 前端 `primeWindow` 的回执：置位后兜底线程不再干预窗口显示。
#[tauri::command]
fn mark_window_primed() {
  WINDOW_PRIMED.store(true, Ordering::Relaxed);
}

/// 清掉历史版本在 WebView2 数据目录里留下的 Service Worker。
///
/// 路径规则：`%LOCALAPPDATA%\<identifier>\EBWebView\Default\Service Worker`。
/// 只删这一个子目录 —— 歌曲库、播放列表等业务数据在同级的 `IndexedDB` 里，不受影响。
fn purge_stale_service_worker(identifier: &str) {
  let Ok(local) = std::env::var("LOCALAPPDATA") else {
    return;
  };
  let dir = Path::new(&local)
    .join(identifier)
    .join("EBWebView")
    .join("Default")
    .join("Service Worker");
  if dir.exists() {
    // 失败也无妨（多实例占用 / 权限不足），下次启动再试
    let _ = std::fs::remove_dir_all(&dir);
  }
}

fn ext_mime(path: &str) -> &'static str {
  let ext = Path::new(path)
    .extension()
    .and_then(|e| e.to_str())
    .map(|e| e.to_lowercase())
    .unwrap_or_default();
  match ext.as_str() {
    "flac" => "audio/flac",
    "mp3" => "audio/mpeg",
    "ogg" | "oga" | "opus" => "audio/ogg",
    "wav" => "audio/wav",
    "m4a" => "audio/mp4",
    "aac" => "audio/aac",
    "webm" => "audio/webm",
    "wma" => "audio/x-ms-wma",
    _ => "application/octet-stream",
  }
}

/// 解析 `bytes=a-b` / `bytes=a-` / `bytes=-n`；返回含首尾的 (start, end)，
/// 结尾一律按 STREAM_CHUNK 封顶以限制单次响应内存
fn parse_range(header: &str, len: u64) -> Option<(u64, u64)> {
  let spec = header.trim().strip_prefix("bytes=")?;
  let last = len.saturating_sub(1);
  let (s, e) = spec.split_once('-')?;
  if s.is_empty() {
    let n: u64 = e.parse().ok()?;
    if n == 0 || len == 0 {
      return None;
    }
    let start = len.saturating_sub(n);
    Some((start, last))
  } else {
    let start: u64 = s.parse().ok()?;
    if start >= len {
      return None;
    }
    let end = if e.is_empty() {
      last
    } else {
      e.parse::<u64>().ok()?.min(last)
    };
    Some((start, end.min(start.saturating_add(STREAM_CHUNK).saturating_sub(1))))
  }
}

fn media_response(status: u16, headers: Vec<(&str, String)>, body: Vec<u8>) -> tauri::http::Response<std::borrow::Cow<'static, [u8]>> {
  let mut b = tauri::http::Response::builder().status(status);
  for (k, v) in headers {
    b = b.header(k, v);
  }
  b.header("Access-Control-Allow-Origin", "*")
    .body(body.into())
    .expect("media response build")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let context = tauri::generate_context!();

  // 桌面端不需要 Service Worker（前端资源已经内嵌进二进制），但历史版本注册过，
  // 而 WebView2 的数据目录是跨版本保留的 —— 那个 SW 会一直活着，用「缓存优先」
  // 规则把旧 index.html（连同旧 hash 的 JS）喂给页面，表现就是
  // 「装了新版本，打开的却还是几周前的界面」。
  //
  // 必须在 WebView2 初始化**之前**清掉：数据目录一旦被它占用，里面的文件就锁了。
  // 所以放在这里而不是 setup 回调（setup 执行时窗口已经建好）。
  purge_stale_service_worker(context.config().identifier.as_str());

  tauri::Builder::default()
    // 单实例锁必须最先挂：二次启动时唤起已有窗口并置前
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      show_main_window(app);
    }))
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // 窗口是 visible:false 创建的，正常路径由前端 primeWindow 定位后 show。
      // 万一前端脚本没跑起来（资源损坏 / JS 异常 / IPC 失败），窗口会永远不出现、
      // 而进程还在后台驻留（托盘在跑），用户只会以为"点了没反应"。
      // 2 秒后仍未收到前端回执就强制居中显示，兜住这条退路。
      {
        let handle = app.handle().clone();
        std::thread::spawn(move || {
          std::thread::sleep(std::time::Duration::from_millis(2000));
          if !WINDOW_PRIMED.load(Ordering::Relaxed) {
            if let Some(w) = handle.get_webview_window("main") {
              let _ = w.center();
              let _ = w.show();
            }
          }
        });
      }

      // 托盘：左键唤起主窗口；菜单提供显示/播放控制/退出
      use tauri::menu::{Menu, MenuItem};
      use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
      let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
      let playpause = MenuItem::with_id(app, "playpause", "播放 / 暂停", true, None::<&str>)?;
      let prev = MenuItem::with_id(app, "prev", "上一曲", true, None::<&str>)?;
      let next = MenuItem::with_id(app, "next", "下一曲", true, None::<&str>)?;
      let quit = MenuItem::with_id(app, "quit", "退出 Onda Player", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&show, &playpause, &prev, &next, &quit])?;
      TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Onda Player")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } = event
          {
            show_main_window(tray.app_handle());
          }
        })
        .on_menu_event(|app, event| {
          match event.id().as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            // 播放控制转发给前端（webview 隐藏时仍在运行）
            id => {
              let _ = app.emit(&format!("tray://{}", id), ());
            }
          }
        })
        .build(app)?;

      Ok(())
    })
    .on_window_event(|window, event| {
      // 关闭 = 最小化到托盘；真正退出只能走托盘菜单「退出」
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
      }
    })
    .register_uri_scheme_protocol("media", |_ctx, request| {
      let Some(query) = request.uri().query() else {
        return media_response(400, vec![], b"missing p".to_vec());
      };
      let encoded = query.split('&').find_map(|kv| kv.strip_prefix("p=")).unwrap_or("");
      let path = urlencoding::decode(encoded)
        .map(|c| c.to_string())
        .unwrap_or_default();
      if path.is_empty() {
        return media_response(400, vec![], b"bad p".to_vec());
      }
      let Ok(file) = std::fs::File::open(&path) else {
        return media_response(404, vec![], b"not found".to_vec());
      };
      let len = file.metadata().map(|m| m.len()).unwrap_or(0);
      let mime = ext_mime(&path).to_string();
      if len == 0 {
        return media_response(
          200,
          vec![("Content-Type", mime), ("Content-Length", "0".into()), ("Accept-Ranges", "bytes".into())],
          vec![],
        );
      }
      let range = request.headers().get("range").and_then(|v| v.to_str().ok());
      let (start, status) = match range.and_then(|h| parse_range(h, len)) {
        Some((s, _)) => (s, 206),
        // 无 Range 也只回包头一段并标注 Content-Range，避免整文件进内存
        None => (0, 206),
      };
      let end = start
        .saturating_add(STREAM_CHUNK)
        .saturating_sub(1)
        .min(len.saturating_sub(1));
      let mut f = file;
      if f.seek(SeekFrom::Start(start)).is_err() {
        return media_response(500, vec![], b"seek failed".to_vec());
      }
      let take = (end - start + 1) as usize;
      let mut buf = Vec::with_capacity(take.min(8 * 1024 * 1024));
      if f.take(take as u64).read_to_end(&mut buf).is_err() {
        return media_response(500, vec![], b"read failed".to_vec());
      }
      let actual_end = start + buf.len() as u64 - 1;
      media_response(
        status,
        vec![
          ("Content-Type", mime),
          ("Content-Length", buf.len().to_string()),
          ("Content-Range", format!("bytes {}-{}/{}", start, actual_end, len)),
          ("Accept-Ranges", "bytes".into()),
        ],
        buf,
      )
    })
    .invoke_handler(tauri::generate_handler![
      list_audio_files,
      read_head,
      read_text_file,
      set_window_effect,
      mark_window_primed
    ])
    .run(context)
    .expect("error while running tauri application");
}
