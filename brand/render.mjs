import sharp from 'file:///C:/Users/12837/.workbuddy/binaries/node/workspace/node_modules/sharp/lib/index.js';

const root = 'D:/项目/音乐播放器/brand/';
const items = [
  ['aurelis-logo.svg', 'png/aurelis-logo.png', 200],
  ['pulse-logo.svg',   'png/pulse-logo.png',   200],
  ['lumen-logo.svg',   'png/lumen-logo.png',   200],
  ['noir-logo.svg',    'png/noir-logo.png',    200],
  ['aurelis-icon.svg', 'png/aurelis-icon.png', 200],
  ['pulse-icon.svg',   'png/pulse-icon.png',   200],
  ['lumen-icon.svg',   'png/lumen-icon.png',   200],
  ['noir-icon.svg',    'png/noir-icon.png',    200],
];

for (const [src, dst, density] of items) {
  await sharp(root + src, { density })
    .png({ compressionLevel: 9 })
    .toFile(root + dst);
  console.log('rendered', dst);
}
console.log('done');
