import sharp from 'sharp'

const MAX_GAIN_DEVIATION = 0.15

function clampGain(gain: number): number {
  return Math.min(1 + MAX_GAIN_DEVIATION, Math.max(1 - MAX_GAIN_DEVIATION, gain))
}

function safeGain(referenceMean: number, channelMean: number): number {
  return channelMean <= 0 ? 1 : clampGain(referenceMean / channelMean)
}

// Gray-world: scales red/blue toward green to correct color cast without touching exposure,
// unlike normalise()'s luminance stretch which darkened well-exposed photos (ai-listings-orp).
//
// stats() and linear() run off one clone()'d pipeline instead of two separate sharp(buffer)
// instances so libvips decodes the image once, not twice -- under concurrent uploads the extra
// decode was enough to push the pod over its memory limit (ai-listings-0yk).
export async function applyGrayWorldWhiteBalance(buffer: Buffer): Promise<Buffer> {
  const image = sharp(buffer)
  const { channels } = await image.clone().stats()
  if (channels.length < 3) return buffer

  const [meanR, meanG, meanB] = channels
  const gainR = safeGain(meanG.mean, meanR.mean)
  const gainB = safeGain(meanG.mean, meanB.mean)
  const gains = channels.length >= 4 ? [gainR, 1, gainB, 1] : [gainR, 1, gainB]

  return image.linear(gains, new Array(gains.length).fill(0)).withMetadata().toBuffer()
}
