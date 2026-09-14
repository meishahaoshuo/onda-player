/**
 * 内联 SVG 图标表（零外部依赖）。
 * path 数据按 24×24 视图绘制（描边风格参考 Feather Icons）。
 */
export const iconPaths = {
  /* 返回上一级（顶栏常驻，位于搜索框左侧）。刻意区分于 close：
     × 在桌面端是「关闭窗口」的系统语义，用它表示返回会与右上角窗口按钮撞语义 */
  back: '<path d="M15 5l-7 7 7 7"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  genre:
    '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none"/>',
  disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>',
  artist:
    '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  folder:
    '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  /* 列表系四个图标刻意各换一种轮廓，废弃原来的「三条横线 + 右侧一个符号」统一模板——
     侧栏的「歌单」行与右侧「新建歌单」按钮**在同一行紧挨着**（实测水平间距 0），
     共用一个底座最容易点错。
     playlist    = 磁带（拟物，两个实心转轴 = 「一盘带子」对应「一辑歌」；用户 2026-09-14 选定）
     playlistAdd = 方框 + 加号（新建，Apple Music「新建播放列表」的做法）
     order       = 平行双箭头（播放顺序，QQ/华为/网易云统一用箭头而非列表）
     queue       = 三条素横线（播放队列，Apple Music / 网易云的做法）
     注：磁带靠**实心转轴 + 描边盒身**的双质感做出体积，这是拟物感的来源。
     **盒身尺寸对齐邻居的墨迹高**：侧栏其余图标墨迹高实测中位 20（占 24 视框 83%），
     第一版盒子只占 12 格（墨迹 14 / 58%），在侧栏里明显显小；
     现取 x2~22、y3~21（20×18，墨迹 22×20，与「文件夹」完全一致） */
  playlist:
    '<rect x="2" y="3" width="20" height="18" rx="3"/><circle cx="8.2" cy="11.4" r="2.7" fill="currentColor" stroke="none"/><circle cx="15.8" cy="11.4" r="2.7" fill="currentColor" stroke="none"/><path d="M7.5 17.3h9"/>',
  playlistAdd: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M12 8.5v7M8.5 12h7"/>',
  settings:
    '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>',
  play: '<path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none"/>',
  pause:
    '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>',
  prev: '<path d="M19 20L9 12l10-8z" fill="currentColor" stroke="none"/><rect x="5" y="4" width="2" height="16" rx="1" fill="currentColor" stroke="none"/>',
  next: '<path d="M5 4l10 8-10 8z" fill="currentColor" stroke="none"/><rect x="17" y="4" width="2" height="16" rx="1" fill="currentColor" stroke="none"/>',
  shuffle:
    '<path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>',
  repeat:
    '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  repeatOne:
    '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><path d="M11 10l2-1v6" stroke-width="1.6"/>',
  /* 顺序播放：平行双箭头（与 shuffle / repeat 同属"箭头家族"，这是主流播放器的共识画法）。
     注意本图标**只表示播放顺序**——歌单页的「排序」按钮已改用 sort，勿再共用 */
  order:
    '<path d="M4 8h13M14 4.5l3.5 3.5-3.5 3.5"/><path d="M4 16h13M14 12.5l3.5 3.5-3.5 3.5"/>',
  /* 播放队列：三条素横线（不加右侧符号，符号会与「新建歌单」撞脸） */
  queue: '<path d="M3 7h18M3 12h18M3 17h18"/>',
  /* 排序：递减行 + 下箭头（与「顺序播放」区分——那个是播放语义，这个是列表排序语义） */
  sort: '<path d="M4 6h9M4 12h6M4 18h3"/><path d="M17 4v14M13.5 14.5l3.5 3.5 3.5-3.5"/>',
  volume:
    '<path d="M11 5L6 9H2v6h4l5 4z" fill="currentColor" stroke="none"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  volumeMute:
    '<path d="M11 5L6 9H2v6h4l5 4z" fill="currentColor" stroke="none"/><path d="M16 9l6 6M22 9l-6 6"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  heart:
    '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  lyrics:
    '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/><path d="M7 9h10M7 13h6"/>',
  expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  monitor:
    '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
  chart:
    '<path d="M6 20v-5M12 20V8M18 20V4"/><path d="M3 20h18"/>',
  trash:
    '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M12 12v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  keyboard:
    '<rect x="2" y="6" width="20" height="14" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 15h6"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  locate:
    '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
} as const

export type IconName = keyof typeof iconPaths
