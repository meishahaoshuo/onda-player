import sharp from 'file:///C:/Users/12837/.workbuddy/binaries/node/workspace/node_modules/sharp/dist/index.mjs';
import { writeFileSync } from 'node:fs';

const root = 'D:/项目/音乐播放器/';
const out = root + 'devlog/.shots-2026-09-15/';

// 启动动画三段波浪（方案 C），深浅两套品牌渐变与 BootSplash.vue 的 CSS 变量一致
const D = 'M210 512 Q 386 384 512 512 T 814 512';
const LAYERS = [-168, 168, 0];

const panel = (x, c1, c2, c3, id) => `
  <g transform="translate(${x},90) scale(0.2793) translate(-154,-224)">
    <defs>
      <linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="330" x2="0" y2="694">
        <stop offset="0" stop-color="${c1}"/><stop offset="0.5" stop-color="${c2}"/><stop offset="1" stop-color="${c3}"/>
      </linearGradient>
    </defs>
${LAYERS.map((dy) => `    <path d="${D}"${dy ? ` transform="translate(0,${dy})"` : ''} stroke-width="88" fill="none" stroke="url(#${id})" stroke-linecap="round"/>`).join('\n')}
  </g>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 320" role="img" aria-label="启动动画 logo 定稿">
  <title>Onda 启动动画 logo 定稿（方案 C）</title>
  <desc>左侧为浅色主题下的启动动画 logo，右侧为深色主题。</desc>
  <rect x="0" y="0" width="680" height="320" fill="#FFFFFF"/>
  <rect x="40" y="40" width="290" height="260" rx="12" fill="#F8F7F4"/>
  ${panel(85, '#3e5a98', '#22356a', '#172554', 'gl')}
  <text x="85" y="278" font-family="'Microsoft YaHei',sans-serif" font-size="13" fill="#5B6470">浅色主题 · 启动动画定稿</text>

  <rect x="350" y="40" width="290" height="260" rx="12" fill="#1A1A1C"/>
  ${panel(395, '#8298db', '#4a64a6', '#2e4280', 'gd')}
  <text x="395" y="278" font-family="'Microsoft YaHei',sans-serif" font-size="13" fill="#9AA0A6">深色主题 · 深蓝在近黑底上提亮一档</text>
</svg>`;

writeFileSync(out + 'bootsplash-final.svg', svg, 'utf8');
const m = await sharp(Buffer.from(svg), { density: 300 }).resize({ width: 1000 }).png({ compressionLevel: 9 }).toFile(out + 'bootsplash-final.png');
console.log('rendered bootsplash-final.png', m.width + 'x' + m.height);
