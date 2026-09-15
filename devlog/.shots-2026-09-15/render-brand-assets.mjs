import sharp from 'file:///C:/Users/12837/.workbuddy/binaries/node/workspace/node_modules/sharp/dist/index.mjs';

const root = 'D:/项目/音乐播放器/';

const jobs = [
  ['public/logo/onda-logo-app.svg', 'public/logo/onda-logo-app.png', 1200],
  ['brand/minimal/onda-icon.svg', 'public/logo/onda-icon-192.png', 192],
  ['brand/minimal/onda-icon.svg', 'public/logo/onda-icon-512.png', 512],
];

for (const [src, dst, width] of jobs) {
  const m = await sharp(root + src, { density: 300 })
    .resize({ width, height: width, fit: 'contain' })
    .png({ compressionLevel: 9 })
    .toFile(root + dst);
  console.log('rendered', dst, m.width + 'x' + m.height);
}

const densityJobs = [
  ['brand/minimal/onda-icon.svg', 'brand/minimal/png/onda-icon.png'],
  ['brand/minimal/onda-logo.svg', 'brand/minimal/png/onda-logo.png'],
];

for (const [src, dst] of densityJobs) {
  const m = await sharp(root + src, { density: 200 })
    .png({ compressionLevel: 9 })
    .toFile(root + dst);
  console.log('rendered', dst, m.width + 'x' + m.height);
}

console.log('done');
