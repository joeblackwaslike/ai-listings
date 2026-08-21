import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { applyGrayWorldWhiteBalance } from './white-balance'

async function solidImage(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer()
}

async function meanChannels(buffer: Buffer): Promise<{ r: number; g: number; b: number }> {
  const { channels } = await sharp(buffer).stats()
  return { r: channels[0].mean, g: channels[1].mean, b: channels[2].mean }
}

test('applyGrayWorldWhiteBalance: neutral gray image is left unchanged', async () => {
  const input = await solidImage(128, 128, 128)
  const output = await applyGrayWorldWhiteBalance(input)
  const before = await meanChannels(input)
  const after = await meanChannels(output)
  assert.ok(Math.abs(after.r - before.r) < 1)
  assert.ok(Math.abs(after.g - before.g) < 1)
  assert.ok(Math.abs(after.b - before.b) < 1)
})

test('applyGrayWorldWhiteBalance: warm color cast moves toward neutral', async () => {
  const input = await solidImage(200, 150, 100)
  const output = await applyGrayWorldWhiteBalance(input)
  const before = await meanChannels(input)
  const after = await meanChannels(output)

  const deltaRBefore = Math.abs(before.r - before.g)
  const deltaRAfter = Math.abs(after.r - after.g)
  assert.ok(deltaRAfter < deltaRBefore, `red should move toward green: ${deltaRAfter} < ${deltaRBefore}`)

  const deltaBBefore = Math.abs(before.b - before.g)
  const deltaBAfter = Math.abs(after.b - after.g)
  assert.ok(deltaBAfter < deltaBBefore, `blue should move toward green: ${deltaBAfter} < ${deltaBBefore}`)
})

test('applyGrayWorldWhiteBalance: does not shift overall brightness by more than 5%', async () => {
  const input = await solidImage(200, 150, 100)
  const output = await applyGrayWorldWhiteBalance(input)
  const before = await meanChannels(input)
  const after = await meanChannels(output)

  const brightnessBefore = (before.r + before.g + before.b) / 3
  const brightnessAfter = (after.r + after.g + after.b) / 3
  const delta = Math.abs(brightnessAfter - brightnessBefore) / brightnessBefore
  assert.ok(delta < 0.05, `brightness delta ${delta} exceeds 5%`)
})

test('applyGrayWorldWhiteBalance: clamps correction on an extreme single-hue image', async () => {
  const input = await solidImage(255, 0, 0)
  const output = await applyGrayWorldWhiteBalance(input)
  const after = await meanChannels(output)

  assert.ok(after.r > 255 * 0.8, `red channel over-corrected: ${after.r}`)
  assert.equal(after.b, 0)
})
