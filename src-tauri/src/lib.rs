use serde::Serialize;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/**
 * 原生文件接入（桌面端，docs/02「桌面端重要说明」）：
 *  - media:// 协议：按 Range 流式返回音频文件，audio.src 直接指向协议 URL，
 *    整文件不进内存；seek 由浏览器的分段 Range 请求驱动
 *  - list_audio_files：递归枚举音频（跳过隐藏目录），返回 path/size/mtime
 *  - read_head：读文件头部若干字节（标签解析用），经 tauri::ipc::Response 走
 *    二进制通道（JSON 数组通道对 MB 级字节太慢）
 *  - read_text_file：读 .lrc 等文本
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
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
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
    .invoke_handler(tauri::generate_handler![list_audio_files, read_head, read_text_file])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
