import { runStructured, ClaudeStructuredOutputError } from '@/lib/claude'
import type { ListingCategory, PhotoShot, Inclusion } from '@/types/listings'

const PHOTO_PLAN_PROMPT = `You are planning the studio photo shoot for a resale listing. Given the item details below, generate an ordered shot list.

Shot order is the shoot sequence — the photographer takes them in this exact order. Assign every shot an \`order\` field (1-indexed).

Ordering principles (reason from these for this specific item — do not copy a template):
1. Shot #1 is the listing thumbnail. It must be the single most compelling full-item image — the one that reads best at postage-stamp size. For a 3D item this is typically an angled front-corner hero shot; for a flat item it's a clean front flat. Never put a detail, close-up, damage, or accessory shot first.
2. Dimensionality drives the rotation. 3D items (bags, shoes, keyboards, watches, most electronics): hero → top-down → front → back → sides → bottom → then details, then accessories, then packaging. Flat items (clothing, flat wallets): front → back → details. Adjust for in-between items.
3. Whole before part. Full-item shots before any detail or close-up. Establish shape and condition first.
4. Exterior before interior. After all exterior sides, reveal the inside (compartments, slots, box contents). Interior shots come after exterior rotation and before detail close-ups.
5. Details in descending importance. Brand/auth marks (stamp, date code, serial) → hardware → condition areas → damage (one shot per distinct area, only if present).
6. Accessories and inclusions after the item itself. One shot per accessory, or all together if small. Packaging last (box closed, then open).
7. Item- and brand-specific reasoning. Apply brand-specific auth mark conventions. A watch with a display case back gets its own prominent shot. Adjust to what this specific item actually has.

Category reference sequences (illustrative — reason about this specific item):
- handbag/bag: angled hero → top-down → front flat → back flat → bottom → interior open → all hardware → brand stamp → date code → serial → strap/handle → damage areas → dust bag → auth card
- small_leather_goods (3D): angled hero → front flat → back flat → interior (all slots) → brand/blind stamp → hardware → date code → damage → accessories
- small_leather_goods (flat): front → back → interior → brand stamp → hardware → damage
- sneakers: angled 3/4 hero (both shoes together, best face) → medial side → toe box → heel → insole with size → outsole → box label → hangtag/extras → damage
- watches: angled hero with watch in open box → full dial front-on → crown → case back (serial + movement if visible) → full band/bracelet → clasp → bezel → crystal edge → damage → papers/inner box
- clothing: front flat → back flat → brand tag → care/size label → material texture (if notable) → damage
- electronics: front powered on (home/boot screen) → back → all ports/sides → serial/IMEI → all accessories together → damage
- keyboards: angled 3/4 beauty shot (front-facing diagonal from above) → top-down full board → left side → right side → bottom → keycap legends close-up → switch stems → stabilizers → damage → box + accessories
- jewelry: angled hero if geometry allows (pendant hanging, ring on stand) → otherwise top-down full → back/clasp → brand/hallmark stamp → stone or detail close-up → scale reference → damage → box/pouch/certificate`

const PHOTO_PLAN_SCHEMA = {
  type: 'object' as const,
  properties: {
    photo_plan: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          shot: { type: 'string' },
          description: { type: 'string' },
          required: { type: 'boolean' },
          photo_type: { type: 'string', enum: ['studio', 'auth_card'] },
          order: { type: 'integer', description: '1-indexed position in shoot sequence. Shot 1 is the thumbnail/hero.' },
          inclusion_ref: { type: 'string', description: 'Inclusion item name this shot documents, if applicable.' },
        },
        required: ['shot', 'description', 'required', 'photo_type', 'order'],
      },
      description: 'Ordered studio shot checklist. Shot #1 is the listing thumbnail.',
    },
  },
  required: ['photo_plan'],
}

export async function generatePhotoPlan({
  category,
  brand,
  notableFeatures,
  inclusions,
  anthropicKey,
}: {
  category: ListingCategory
  brand: string
  notableFeatures: string[]
  inclusions: Inclusion[]
  anthropicKey: string
}): Promise<PhotoShot[]> {
  const confirmedInclusions = inclusions.filter((i) => i.confirmed)
  const inclusionLines = confirmedInclusions.length > 0
    ? `\nConfirmed inclusions: ${confirmedInclusions.map((i) => i.item + (i.notes ? ` (${i.notes})` : '')).join(', ')}`
    : ''

  const itemContext = [
    `Brand: ${brand}`,
    `Category: ${category}`,
    notableFeatures.length > 0 ? `Features: ${notableFeatures.join('; ')}` : null,
    inclusionLines || null,
  ].filter(Boolean).join('\n')

  let output: { photo_plan: PhotoShot[] }
  try {
    output = await runStructured<{ photo_plan: PhotoShot[] }>({
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 1024,
      prompt: `${PHOTO_PLAN_PROMPT}\n\nItem details:\n${itemContext}`,
      apiKey: anthropicKey,
      toolName: 'generate_photo_plan',
      toolDescription: 'Generate an ordered studio shot checklist for this item',
      jsonSchema: PHOTO_PLAN_SCHEMA,
    })
  } catch (err) {
    if (err instanceof ClaudeStructuredOutputError) {
      throw new Error('generatePhotoPlan: Claude did not return a tool_use block')
    }
    throw err
  }

  return output.photo_plan
}
