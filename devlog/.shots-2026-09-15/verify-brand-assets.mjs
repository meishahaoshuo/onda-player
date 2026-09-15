import sharp from 'file:///C:/Users/12837/.workbuddy/binaries/node/workspace/node_modules/sharp/dist/index.mjs';

const root = 'D:/项目/音乐播放器/';

// design 空间期望值（1024 viewBox，方案 C）：波浪墨迹 692 × 552，中心 (512,512)
const jobs = [
  ['public/logo/onda-logo-app.png', 1200 / 1024, 692, 552],
  ['public/logo/onda-icon-512.png', 512 / 1024, 692, 552],
  ['public/logo/onda-icon-192.png', 192 / 1024, 692, 552],
  ['brand/minimal/png/onda-icon.png', 2844 / 1024, 692, 552],
  // 横版组合：波形在 760×200 里是 translate(36,22) scale(0.145)，再乘 density 缩放
  ['brand/minimal/png/onda-logo.png', 2111 / 760, 100.4, 80.0],
];

for (const [file, scale, expW, expH] of jobs) {
  const { data, info } = await sharp(root + file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      // 只认「蓝」像素：品牌渐变三色 B-R 均 > 60，可排除白底、ONDA 黑字与 澜 灰字
      if (a > 8 && b - r > 35) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        n++;
      }
    }
  }
  const dw = (x1 - x0 + 1) / scale, dh = (y1 - y0 + 1) / scale;
  const ok = Math.abs(dw - expW) <= 6 && Math.abs(dh - expH) <= 6;
  console.log(
    file.padEnd(36),
    '波浪墨迹(design)', (dw.toFixed(1) + '×' + dh.toFixed(1)).padEnd(14),
    '期望', (expW + '×' + expH).padEnd(10),
    ok ? 'OK' : '!! 不符'
  );
}
