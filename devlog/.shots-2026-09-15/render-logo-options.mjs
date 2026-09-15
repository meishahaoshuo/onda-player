import sharp from 'file:///C:/Users/12837/.workbuddy/binaries/node/workspace/node_modules/sharp/dist/index.mjs';

const root = 'D:/项目/音乐播放器/';
const out = root + 'devlog/.shots-2026-09-15/';

const items = [
  ['public/logo/onda-logo-app.svg', 'logo-ref-current.png'],
  ['brand/minimal/onda-mark-uniform.svg', 'logo-ref-uniform.png'],
  ['brand/minimal/onda-opt-a-taper.svg', 'logo-opt-a-taper.png'],
  ['brand/minimal/onda-opt-b-ripple.svg', 'logo-opt-b-ripple.png'],
  ['brand/minimal/onda-opt-c-airy.svg', 'logo-opt-c-airy.png'],
];

for (const [src, dst] of items) {
  const meta = await sharp(root + src, { density: 300 })
    .resize({ width: 480 })
    .png({ compressionLevel: 9 })
    .toFile(out + dst);
  console.log('rendered', dst, meta.width + 'x' + meta.height);
}
console.log('done');
