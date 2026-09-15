import sharp from 'file:///C:/Users/12837/.workbuddy/binaries/node/workspace/node_modules/sharp/dist/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const root = 'D:/项目/音乐播放器/';
const N = 1024;

// —— 1. 从 BootSplash.vue 抠真实常量 ——
const vue = readFileSync(root + 'src/components/BootSplash.vue', 'utf8');
const waveD = vue.match(/const WAVE_D = '([^']+)'/)[1];
const layerBlock = vue.match(/const LAYERS = \[([\s\S]*?)\]/)[1];
const layers = [...layerBlock.matchAll(/\{\s*dy:\s*(-?\d+),\s*w:\s*(\d+),\s*delay:\s*(\d+)\s*\}/g)].map((m) => ({
  dy: Number(m[1]),
  w: Number(m[2]),
}));
const grad = vue.match(/--boot-wave-1:\s*(#[0-9a-f]{6});[\s\S]*?--boot-wave-2:\s*(#[0-9a-f]{6});[\s\S]*?--boot-wave-3:\s*(#[0-9a-f]{6});/);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}">
  <defs>
    <linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="330" x2="0" y2="694">
      <stop offset="0" stop-color="${grad[1]}"/>
      <stop offset="0.5" stop-color="${grad[2]}"/>
      <stop offset="1" stop-color="${grad[3]}"/>
    </linearGradient>
  </defs>
${layers
  .map(
    (l) =>
      `  <path d="${waveD}"${l.dy ? ` transform="translate(0,${l.dy})"` : ''} stroke-width="${l.w}" fill="none" stroke="url(#g)" stroke-linecap="round"/>`,
  )
  .join('\n')}
</svg>`;
const tmp = root + 'devlog/.shots-2026-09-15/_bootsplash-extracted.svg';
writeFileSync(tmp, svg, 'utf8');

// —— 2. 两份都保留 alpha 渲染，按 alpha 通道量墨迹（透明底不会污染）——
async function load(p) {
  const { data, info } = await sharp(p, { density: 300 })
    .resize(N, N, { fit: 'contain' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, ch: info.channels, w: info.width, h: info.height };
}
function inkBox({ data, ch, w, h }) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * ch + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

const A = await load(tmp);
const B = await load(root + 'public/logo/onda-logo-app.svg');
const [ax, ay, aw, ah] = inkBox(A);
const [bx, by, bw, bh] = inkBox(B);

console.log('BootSplash 实测常量: WAVE_D =', waveD, '| LAYERS =', JSON.stringify(layers), '| 渐变 =', grad[1], grad[2], grad[3]);
console.log('');
console.log('启动动画 logo 墨迹 =', aw + '×' + ah, ' 位置', ax + ',' + ay);
console.log('品牌源文件   墨迹 =', bw + '×' + bh, ' 位置', bx + ',' + by);
console.log('尺寸/位置一致:', aw === bw && ah === bh && ax === bx && ay === by ? 'OK（完全重合）' : '!! 不一致');
console.log('');

let maskDiff = 0, softDiff = 0, maxd = 0;
for (let i = 3; i < A.data.length; i += A.ch) {
  const da = A.data[i], db = B.data[i];
  const d = Math.abs(da - db);
  if (d > maxd) maxd = d;
  if (d > 128) maskDiff++;
  else if (d > 32) softDiff++;
}
const total = N * N;
console.log('硬性差异像素(alpha 差>128) =', maskDiff, '(' + ((maskDiff / total) * 100).toFixed(3) + '%)');
console.log('边缘抗锯齿差(alpha 差 32~128) =', softDiff, '(' + ((softDiff / total) * 100).toFixed(3) + '%)');
console.log('最大 alpha 差 =', maxd);
console.log(maskDiff / total < 0.002 ? '→ 二者形状等价（差异仅落在抗锯齿边缘）OK' : '→ 形状有实质出入，需排查');
