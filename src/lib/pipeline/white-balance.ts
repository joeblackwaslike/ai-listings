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
export async function applyGrayWorldWhiteBalance(buffer: Buffer): Promise<Buffer> {
  const { channels } = await sharp(buffer).stats()
  if (channels.length < 3) return buffer

  const [meanR, meanG, meanB] = channels
  const gainR = safeGain(meanG.mean, meanR.mean)
  const gainB = safeGain(meanG.mean, meanB.mean)
  const gains = channels.length >= 4 ? [gainR, 1, gainB, 1] : [gainR, 1, gainB]

  return sharp(buffer).linear(gains, new Array(gains.length).fill(0)).toBuffer()
}
