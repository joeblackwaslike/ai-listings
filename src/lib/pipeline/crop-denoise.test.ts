import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { DENOISE_STRENGTH, strengthToMedianSize, cropDenoiseAndFlatten } from './crop-denoise'

async function borderedImage(): Promise<Buffer> {
  // 40x40 white canvas with a uniform gray 20x20 square inset -- trim({threshold:10}) should
  // crop the white border down close to the inset square's bounds.
  return sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([
      {
        input: await sharp({
          create: { width: 20, height: 20, channels: 4, background: { r: 120, g: 120, b: 120, alpha: 1 } },
        })
          .png()
          .toBuffer(),
        top: 10,
        left: 10,
      },
    ])
    .png()
    .toBuffer()
}

async function noisyImage(width: number, height: number): Promise<Buffer> {
  const channels = 3
  const raw = Buffer.alloc(width * height * channels)
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256)
  return sharp(raw, { raw: { width, height, channels } }).png().toBuffer()
}

test('strengthToMedianSize: 30% strength (DENOISE_STRENGTH) maps to median(3), the mildest setting', () => {
  assert.equal(DENOISE_STRENGTH, 0.3)
  assert.equal(strengthToMedianSize(0.3), 3)
})

test('strengthToMedianSize: only ever returns valid odd sharp median sizes across the 0-1 range', () => {
  for (let s = 0; s <= 1; s += 0.05) {
    const size = strengthToMedianSize(s)
    assert.ok(size >= 3, `size ${size} below sharp's minimum of 3`)
    assert.equal(size % 2, 1, `size ${size} is not odd`)
  }
})

test('cropDenoiseAndFlatten: crops the uniform border (auto-crop applies to every raw photo, not just bg-removed ones)', async () => {
  const input = await borderedImage()
  const inputMeta = await sharp(input).metadata()
  const output = await cropDenoiseAndFlatten(input)
  const outputMeta = await sharp(output).metadata()

  assert.ok(outputMeta.width! < inputMeta.width!, `expected crop: ${outputMeta.width} < ${inputMeta.width}`)
  assert.ok(outputMeta.height! < inputMeta.height!, `expected crop: ${outputMeta.height} < ${inputMeta.height}`)
})

test('cropDenoiseAndFlatten: denoises via median filter, reducing per-channel variance on a noisy photo', async () => {
  const input = await noisyImage(60, 60)
  const output = await cropDenoiseAndFlatten(input)

  const inputStats = await sharp(input).stats()
  const outputStats = await sharp(output).stats()

  assert.ok(
    outputStats.channels[0].stdev < inputStats.channels[0].stdev,
    `expected denoise to reduce stdev: ${outputStats.channels[0].stdev} < ${inputStats.channels[0].stdev}`
  )
})
