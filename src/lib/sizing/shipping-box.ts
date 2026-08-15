import type { ListingCategory, Measurements, ShippingBoxDims } from '@/types/listings'

// Packing-material estimate (bubble wrap/paper + box-wall clearance), not a sourced carrier
// spec -- same constant across every category. Adjust once real packages get compared
// against it; see Feature 3 in docs/superpowers/specs/2026-08-15-jewelry-shoe-measurement-gate-design.md.
export const SHIPPING_BOX_PADDING_IN = 2

// Computed from item dims collected at the identity gate, never asked for directly.
// Returns null when the required item dims aren't present yet (gate not yet confirmed, or
// a category with no dimension fields at all -- clothing, ring/bangle/necklace jewelry).
export function computeEstimatedShippingBox(
  category: ListingCategory | string | null,
  measurements: Measurements | null
): ShippingBoxDims | null {
  if (!measurements) return null

  if (category === 'sneakers') {
    const { item_length_in, item_width_in, item_height_in } = measurements
    if (item_length_in == null || item_width_in == null || item_height_in == null) return null
    // The box has to fit both shoes of the pair, not one -- length and height are shared,
    // width doubles (two shoes side by side).
    const pairWidth = item_width_in * 2
    return {
      length: item_length_in + 2 * SHIPPING_BOX_PADDING_IN,
      width: pairWidth + 2 * SHIPPING_BOX_PADDING_IN,
      height: item_height_in + 2 * SHIPPING_BOX_PADDING_IN,
    }
  }

  const { width, height, depth } = measurements
  if (width == null || height == null || depth == null) return null
  return {
    length: depth + 2 * SHIPPING_BOX_PADDING_IN,
    width: width + 2 * SHIPPING_BOX_PADDING_IN,
    height: height + 2 * SHIPPING_BOX_PADDING_IN,
  }
}
