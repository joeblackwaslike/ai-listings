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

async function exifRotatedBarImage(): Promise<Buffer> {
  // 60x100 canvas (portrait sensor dims) with a horizontal 40x10 colored bar inset, tagged
  // with EXIF orientation 6 (rotate 90deg CW to display correctly) -- simulates a phone photo
  // taken with the device rotated, the common real-world case that leaves photos sideways
  // when EXIF orientation isn't honored before processing.
  const bar = await sharp({
    create: { width: 40, height: 10, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } },
  })
    .png()
    .toBuffer()

  return sharp({
    create: { width: 60, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([{ input: bar, top: 45, left: 10 }])
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer()
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

test('cropDenoiseAndFlatten: auto-orients from EXIF before cropping, so a sideways camera capture is not left sideways', async () => {
  const input = await exifRotatedBarImage()
  const inputMeta = await sharp(input).metadata()
  assert.equal(inputMeta.orientation, 6, 'fixture must carry EXIF orientation 6 (rotate 90deg CW to display correctly)')

  const output = await cropDenoiseAndFlatten(input)
  const outputMeta = await sharp(output).metadata()

  // Orientation 6 means the stored pixel bar (wide: 40x10) must display tall once corrected --
  // auto-orienting before trim is what makes the cropped output reflect the corrected shape
  // instead of the raw sensor shape (which would stay wider than tall).
  assert.ok(
    outputMeta.height! > outputMeta.width!,
    `expected auto-oriented crop to be taller than wide: ${outputMeta.width}x${outputMeta.height}`
  )
})
