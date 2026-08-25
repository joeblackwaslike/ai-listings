import sharp from 'sharp'
import '@/lib/sharp-config'

// Sharp's median() filter only accepts odd integers >= 3, so there's no continuous 0-100%
// scale to map "denoise strength" onto directly. These are resale product photos where real
// condition detail (scuffs, stitching, wear) must survive -- median filtering removes
// sensor/JPEG noise while preserving edges far better than a gaussian blur would, but
// anything stronger than the mildest setting risks eroding that detail. The bands below are
// deliberately front-loaded toward the mild end so 30% strength lands on median(3), the
// mildest size sharp offers.
export const DENOISE_STRENGTH = 0.3

const MEDIAN_SIZE_BANDS: ReadonlyArray<{ maxStrength: number; size: number }> = [
  { maxStrength: 0.3, size: 3 },
  { maxStrength: 0.5, size: 5 },
  { maxStrength: 0.7, size: 7 },
  { maxStrength: 1, size: 9 },
]

export function strengthToMedianSize(strength: number): number {
  const clamped = Math.min(1, Math.max(0, strength))
  const band = MEDIAN_SIZE_BANDS.find((b) => clamped <= b.maxStrength)
  return (band ?? MEDIAN_SIZE_BANDS[MEDIAN_SIZE_BANDS.length - 1]).size
}

// Crops uniform/transparent borders, denoises, then flattens onto white. Shared by the
// background-removal path (remove-background.ts) and the skip-background-removal path
// (process-raw-photo.ts) so every raw photo gets identical crop + denoise treatment
// regardless of which path produced it.
export async function cropDenoiseAndFlatten(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    // Auto-orient from EXIF before anything else -- camera uploads (especially portrait shots
    // from phones) store pixels in the sensor's orientation and rely on the EXIF tag to display
    // correctly. jpeg().toBuffer() alone doesn't honor that tag, so without this the trim/median
    // crop below would operate on, and the output would stay in, the sideways sensor orientation.
    .rotate()
    .trim({ threshold: 10 })
    .median(strengthToMedianSize(DENOISE_STRENGTH))
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .jpeg({ quality: 92 })
    .toBuffer()
}
