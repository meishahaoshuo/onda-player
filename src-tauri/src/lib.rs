use serde::{Deserialize, Serialize};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{
  Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};

/**
 * 原生文件接入（桌面端，docs/02「桌面端重要说明」）：
 *  - media:// 协议：按 Range 流式返回音频文件，audio.src 直接指向协议 URL，
 *    整文件不进内存；seek 由浏览器的分段 Range 请求驱动
 *  - list_audio_files：递归枚举音频（跳过隐藏目录），返回 path/size/mtime
 *  - read_head：读文件头部若干字节（标签解析用），经 tauri::ipc::Response 走
 *    二进制通道（JSON 数组通道对 MB 级字节太慢）
 *  - read_text_file：读 .lrc 等文本
 *
 * 桌面特性（9.5）：无边框窗口（不透明，窗口材质已移除）、
 * 托盘（左键唤窗、右键展开自绘浮层菜单，见下方 TrayStateCache 区段）、
 * 关闭即隐藏到托盘（退出走浮层菜单）、单实例锁（二次启动唤起已有窗口）。
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

/* ------------------------------------------------------------------ *
 * 托盘浮层菜单（自绘）
 *
 * 系统原生托盘菜单（tauri::menu）只能改文字与启用态：字体、行高、内边距、
 * 圆角、配色全由 Windows 决定，也做不出「横向按钮行」和「正在播放」卡头。
 * 所以改成自绘 —— 一个无边框、透明、置顶、跳过任务栏的小窗口（label
 * `tray-menu`），右键托盘时定位到光标处展开，界面由前端 TrayMenu.vue 画。
 *
 * 交互闭环：
 *   托盘右键 → open_tray_menu（定位 + show + 重发状态）
 *   浮层点任意项 → 广播 tray 事件给主窗口 / 调命令 → invoke('tray_menu_hide')
 *   浮层失焦 → Rust 侧直接 hide
 * ------------------------------------------------------------------ */

const TRAY_MENU_WIN: &str = "tray-menu";
/// 浮层宽度固定（逻辑像素）；高度由前端按内容量出来回报
const TRAY_MENU_W: f64 = 268.0;
const TRAY_MENU_H_FALLBACK: f64 = 430.0;

/// 主窗口推到浮层的状态。刻意保持精简：封面只传 coverId，浮层自己从
/// IndexedDB 取图（同源、同 WebView2 数据目录），省掉 base64 来回搬运。
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrayState {
  title: String,
  artist: String,
  cover_id: Option<String>,
  playing: bool,
  favorited: bool,
}

/// 状态缓存：浮层常驻隐藏，单靠广播会漏掉「它打开之前」发生的那次更新，
/// 所以展开时把最近一份重发过去，保证菜单一出现就是当前状态。
#[derive(Default)]
struct TrayStateCache(Mutex<Option<TrayState>>);

/// 在独立线程上创建浮层窗口（幂等）。
///
/// ⚠️ **绝不能在同步 command 或托盘事件回调里直接建窗口**：Windows 上 webview 的
/// 初始化必须回到主线程，而同步 command 正占着主线程 → 必死锁。
/// 实测症状：前端启动 2.5 秒调 `tray_menu_prepare` 后，整窗「无响应」、机器跟着卡，
/// 与 Tauri 文档「Creating windows in a sync command causes a deadlock on Windows」一致。
/// 所以这里统一走 `std::thread::spawn`，让主线程空出来接 webview 初始化。
fn spawn_tray_menu_window(app: &tauri::AppHandle) {
  if app.get_webview_window(TRAY_MENU_WIN).is_some() {
    return;
  }
  let app = app.clone();
  std::thread::spawn(move || {
    if let Ok(win) = ensure_tray_menu_window(&app) {
      let _ = win.hide();
    }
  });
}

/// 创建浮层窗口本体。窗口以 visible:false 出生、初始位置在屏幕外，
/// 之后只做「定位 + show」，绝不重建 —— 重建会有明显白闪。
/// ⚠️ 只允许在独立线程上调用（见 `spawn_tray_menu_window`）。
fn ensure_tray_menu_window(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
  if let Some(w) = app.get_webview_window(TRAY_MENU_WIN) {
    return Ok(w);
  }

  let win = WebviewWindowBuilder::new(
    app,
    TRAY_MENU_WIN,
    WebviewUrl::App("index.html?tray=1".into()),
  )
  .title("Onda 托盘菜单")
  .inner_size(TRAY_MENU_W, TRAY_MENU_H_FALLBACK)
  .position(-20000.0, -20000.0)
  .decorations(false)
  .transparent(true)
  /* 背景色必须显式给全透明：`transparent(true)` 只让**窗口**透明，
     Windows 上 webview 图层默认仍是**不透明白**（Tauri 配置 schema 原话：
     「if alpha channel is not 0, it will be ignored for the webview layer」）。
     不设的话，卡片圆角外那圈本该透明的地方会是一块白，阴影也糊在白底上。 */
  .background_color(tauri::webview::Color(0, 0, 0, 0))
  .resizable(false)
  .maximizable(false)
  .minimizable(false)
  .skip_taskbar(true)
  .always_on_top(true)
  .shadow(false)
  .visible(false)
  .focused(false)
  .build()?;

  // 失焦即收起：托盘菜单最基本的交互预期
  let w = win.clone();
  win.on_window_event(move |e| {
    if let tauri::WindowEvent::Focused(false) = e {
      let _ = w.hide();
    }
  });

  Ok(win)
}

/// 在光标处展开浮层：右下角对齐光标，并夹进所在显示器的可用区域（贴边不被切）。
fn open_tray_menu(app: &tauri::AppHandle, cursor: PhysicalPosition<f64>) {
  let Some(win) = app.get_webview_window(TRAY_MENU_WIN) else {
    // 还没预热好：这次先不弹（交给独立线程去建），下一次右键就能用了。
    // 在托盘回调里直接建窗口同样会死锁，见 spawn_tray_menu_window 的说明。
    spawn_tray_menu_window(app);
    return;
  };

  let size = win
    .outer_size()
    .unwrap_or(PhysicalSize::new(
      TRAY_MENU_W as u32,
      TRAY_MENU_H_FALLBACK as u32,
    ));
  let (mw, mh) = (size.width as f64, size.height as f64);
  let mut x = cursor.x - mw;
  let mut y = cursor.y - mh;

  if let Ok(Some(mon)) = app.monitor_from_point(cursor.x, cursor.y) {
    let (mp, ms) = (mon.position(), mon.size());
    let (l, t) = (mp.x as f64, mp.y as f64);
    let (r, b) = (l + ms.width as f64, t + ms.height as f64);
    x = x.clamp(l + 4.0, (r - mw - 4.0).max(l + 4.0));
    y = y.clamp(t + 4.0, (b - mh - 4.0).max(t + 4.0));
  }

  let _ = win.set_position(PhysicalPosition::new(x, y));
  let _ = win.show();
  let _ = win.set_focus();

  if let Some(state) = app.state::<TrayStateCache>().0.lock().unwrap().clone() {
    let _ = win.emit("tray://state", state);
  }
}

/// 预热浮层窗口：前端在启动过场收尾后调用，让首次右键不等待。
/// ⚠️ 这里只负责「派线程」，绝不在本线程上建窗口（同步 command 会死锁）。
#[tauri::command]
fn tray_menu_prepare(app: tauri::AppHandle) {
  spawn_tray_menu_window(&app);
}

/// 浮层按内容高度自适应（宽度固定）。用逻辑像素，避免高 DPI 下尺寸错位。
#[tauri::command]
fn tray_menu_resize(window: tauri::WebviewWindow, height: f64) {
  if window.label() != TRAY_MENU_WIN {
    return;
  }
  let h = height.clamp(120.0, 900.0);
  let _ = window.set_size(LogicalSize::new(TRAY_MENU_W, h));
}

/// 收起浮层（浮层点了任意一项、或按 Esc 时调）
#[tauri::command]
fn tray_menu_hide(window: tauri::WebviewWindow) {
  if window.label() == TRAY_MENU_WIN {
    let _ = window.hide();
  }
}

/// 显示并聚焦主窗口（浮层的「显示主窗口」）
#[tauri::command]
fn tray_show_main(app: tauri::AppHandle) {
  show_main_window(&app);
}

/// 退出应用（浮层的「退出」）
#[tauri::command]
fn tray_quit(app: tauri::AppHandle) {
  app.exit(0);
}

/// 主窗口推送浮层状态：缓存一份，同时转发给浮层（浮层已在监听）
#[tauri::command]
fn tray_menu_state(app: tauri::AppHandle, state: TrayState) {
  *app.state::<TrayStateCache>().0.lock().unwrap() = Some(state.clone());
  if let Some(w) = app.get_webview_window(TRAY_MENU_WIN) {
    let _ = w.emit("tray://state", state);
  }
}

/// 浮层挂载好、监听注册完之后主动要一次状态。
/// 防止「状态在它监听注册之前就被发出」—— 尤其首次右键时浮层可能刚建好还在加载。
#[tauri::command]
fn tray_menu_state_sync(app: tauri::AppHandle) {
  if let Some(state) = app.state::<TrayStateCache>().0.lock().unwrap().clone() {
    if let Some(w) = app.get_webview_window(TRAY_MENU_WIN) {
      let _ = w.emit("tray://state", state);
    }
  }
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
    // 托盘浮层的状态缓存（主窗口推送，展开时回放）
    .manage(TrayStateCache::default())
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

      // 托盘：左键唤起主窗口；右键在光标处展开自绘浮层菜单（见 open_tray_menu）。
      // 不再挂原生 menu —— 一旦挂了，右键会被系统菜单吃掉，我们的浮层就展不开。
      use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
      TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Onda Player")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click {
            button,
            button_state: MouseButtonState::Up,
            position,
            ..
          } = event
          {
            match button {
              MouseButton::Left => show_main_window(tray.app_handle()),
              MouseButton::Right => open_tray_menu(tray.app_handle(), position),
              _ => {}
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
      mark_window_primed,
      tray_menu_prepare,
      tray_menu_resize,
      tray_menu_hide,
      tray_show_main,
      tray_quit,
      tray_menu_state,
      tray_menu_state_sync
    ])
    .run(context)
    .expect("error while running tauri application");
}
