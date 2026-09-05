import sharp from 'file:///C:/Users/12837/.workbuddy/binaries/node/workspace/node_modules/sharp/dist/index.mjs';

const root = 'D:/项目/音乐播放器/brand/minimal/';
const items = [
  ['halo-icon.svg',   'png/halo-icon.png',   200],
  ['motif-icon.svg',  'png/motif-icon.png',  200],
  ['beam-icon.svg',   'png/beam-icon.png',   200],
  ['onda-icon.svg',   'png/onda-icon.png',   200],
  ['pillar-icon.svg', 'png/pillar-icon.png', 200],
  ['halo-logo.svg',   'png/halo-logo.png',   200],
  ['motif-logo.svg',  'png/motif-logo.png',  200],
  ['beam-logo.svg',   'png/beam-logo.png',   200],
  ['onda-logo.svg',   'png/onda-logo.png',   200],
  ['pillar-logo.svg', 'png/pillar-logo.png', 200],
];
for (const [src, dst, density] of items) {
  await sharp(root + src, { density }).png({ compressionLevel: 9 }).toFile(root + dst);
  console.log('rendered', dst);
}
console.log('done');
