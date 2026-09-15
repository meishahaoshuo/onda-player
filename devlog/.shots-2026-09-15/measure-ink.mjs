import sharp from 'file:///C:/Users/12837/.workbuddy/binaries/node/workspace/node_modules/sharp/dist/index.mjs';

const out = 'D:/项目/音乐播放器/devlog/.shots-2026-09-15/';
const files = [
  ['logo-ref-current.png', 692, 548],
  ['logo-ref-uniform.png', 692, 548],
  ['logo-opt-a-taper.png', 572, 548],
  ['logo-opt-b-ripple.png', 692, 500],
  ['logo-opt-c-airy.png', 692, 552],
];

const K = 1024 / 480;

for (const [f, expW, expH] of files) {
  const { data, info } = await sharp(out + f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * channels + 3];
      if (a > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const designW = Math.round(bw * K), designH = Math.round(bh * K);
  const cx = Math.round(((x0 + x1) / 2) * K), cy = Math.round(((y0 + y1) / 2) * K);
  const ok = Math.abs(designW - expW) <= 4 && Math.abs(designH - expH) <= 4;
  console.log(
    f.padEnd(24),
    '设计空间墨迹', (designW + '×' + designH).padEnd(9),
    '期望', (expW + '×' + expH).padEnd(9),
    '中心', (cx + ',' + cy).padEnd(9),
    ok ? 'OK' : '!! 偏差'
  );
}
