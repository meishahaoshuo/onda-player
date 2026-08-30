/**
 * 歌词页环境背景：把封面缩成极小的色块图（保留封面的颜色构图），
 * 再由 CSS 拉伸 + 大半径模糊，得到「颜色来自封面但看不出原图」的柔和渐变。
 * 相比提取离散主色，这种方式的颜色分布与封面自然一致，不会产生突兀的配色。
 */

export async function makeAmbientGradient(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob)
  try {
    const w = 32
    const h = Math.max(8, Math.round((w * bitmap.height) / bitmap.width))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.filter = 'saturate(1.35) brightness(1.02)'
    ctx.drawImage(bitmap, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', 0.75)
  } finally {
    bitmap.close()
  }
}
