import { runStructured, ClaudeStructuredOutputError } from '@/lib/claude'
import type { ListingCategory, ConditionValue, PhotoShot, Inclusion } from '@/types/listings'
import type { ProductIdData } from './step1-product-id'
import { pushPipelineStep } from './supabase-push'
import type { ApiKeys } from '@/lib/user-api-keys'
import { toPublicUrl } from './to-public-url'
import { getInclusionChecklist } from '@/lib/inclusions'
import { mergeDetectedInclusions } from '@/lib/inclusions'
import type { InclusionChecklistItem } from '@/lib/inclusions'

const LUXURY_BRANDS = new Set([
  'Chanel',
  'Louis Vuitton',
  'Gucci',
  'Hermès',
  'Prada',
  'Balenciaga',
  'Christian Louboutin',
  'Dior',
  'Burberry',
  'Versace',
  'Saint Laurent',
  'Bottega Veneta',
  'Fendi',
  'Valentino',
  'Givenchy',
  'Movado',
  'Rolex',
  'Omega',
  'Cartier',
  'TAG Heuer',
  'Hublot',
  'Patek Philippe',
  'IWC',
  'Breguet',
  'Jaeger-LeCoultre',
])

const INCLUSIONS_ITEM_SCHEMA = {
  type: 'object' as const,
  properties: {
    item: { type: 'string' as const },
    notes: { type: 'string' as const, nullable: true },
    tagState: { type: 'string' as const, enum: ['attached', 'severed'], nullable: true },
    docSource: { type: 'string' as const, enum: ['original', 'reseller', 'third_party'], nullable: true },
  },
  required: ['item', 'notes', 'tagState', 'docSource'],
}

function buildInclusionsDescription(checklist: InclusionChecklistItem[]): string {
  return `Items visible alongside the product. Explicitly check for each of: ${checklist.map((c) => c.item).join(', ')}. Only include items you can actually see -- do not guess at items not visible. For any tag, set tagState to whether it is still attached to the item or has been cut off. For any authenticity card, set docSource: "original" if brand-issued, "reseller" if issued by a resale platform (e.g. TheRealReal's own item-code tag), "third_party" if it's a separate authentication service's documentation.`
}

type DetectedInclusion = { item: string; notes: string | null; tagState?: 'attached' | 'severed'; docSource?: 'original' | 'reseller' | 'third_party' }

export async function detectInclusionsFromPhoto(
  photoUrl: string,
  checklist: InclusionChecklistItem[],
  apiKeys: ApiKeys
): Promise<DetectedInclusion[]> {
  const publicPhotoUrl = await toPublicUrl(photoUrl)
  let output: { inclusions: DetectedInclusion[] }
  try {
    output = await runStructured<{ inclusions: DetectedInclusion[] }>({
      model: 'claude-sonnet-4-6',
      maxTokens: 1024,
      prompt: 'You are reviewing a studio photo for a resale listing platform. Identify any accessory items visible alongside the product using the extract_inclusions tool.',
      image: { url: publicPhotoUrl },
      apiKey: apiKeys.anthropic,
      toolName: 'extract_inclusions',
      toolDescription: 'Extract accessory items visible in the photo',
      jsonSchema: {
        type: 'object' as const,
        properties: {
          inclusions: {
            type: 'array',
            items: INCLUSIONS_ITEM_SCHEMA,
            description: buildInclusionsDescription(checklist),
          },
        },
        required: ['inclusions'],
      },
    })
  } catch (err) {
    if (err instanceof ClaudeStructuredOutputError) {
      throw new Error('detectInclusionsFromPhoto: Claude did not return a tool_use block')
    }
    throw err
  }
  return output.inclusions
}

export interface VisionAnalysis {
  ok: true
  brand: string
  category: ListingCategory
  condition: ConditionValue
  conditionNotes: string
  notableFeatures: string[]
  isLuxury: boolean
  inclusions: Inclusion[]
  photoPlan: PhotoShot[]
  confidenceNote: string
}

type VisionOutput = {
  brand: string
  category: ListingCategory
  condition: ConditionValue
  condition_notes: string
  notable_features: string[]
  inclusions: DetectedInclusion[]
  photo_plan: Array<{
    shot: string
    description: string
    required: boolean
    photo_type: 'intake' | 'processed' | 'auth_card' | 'studio'
    order: number
  }>
  confidence_note: string
}

export async function runStep2VisionAnalysis(
  listingId: string,
  photoUrl: string,
  step1: ProductIdData,
  apiKeys: ApiKeys,
  corrections: string | null = null,
): Promise<VisionAnalysis> {
  console.log(`[step2] starting vision analysis for listing ${listingId}`)
  const publicPhotoUrl = await toPublicUrl(photoUrl)
  // Checklist is best-effort here -- category is step1's pre-classification hint (possibly
  // 'other' if Lens found no matches), not yet Claude's own authoritative classification,
  // which only exists after this call returns. subType isn't computed until gender_gate,
  // well after this function runs, so it's always null at this call site.
  const checklist = getInclusionChecklist(step1.category, null)
  console.log(`[step2] public photo URL: ${publicPhotoUrl}, calling Claude...`)

  const correctionContext = corrections
    ? `\n\nUSER CORRECTION: The previous identification was wrong. The user says: "${corrections}". Prioritize this correction.`
    : ''

  const attrsStr = step1.knowledgeGraphAttributes
    ? Object.entries(step1.knowledgeGraphAttributes).map(([k, v]) => `${k}: ${v}`).join(', ')
    : null

  const kgContext = [
    step1.knowledgeGraphDescription ? `Description: ${step1.knowledgeGraphDescription}` : null,
    attrsStr ? `Attributes: ${attrsStr}` : null,
  ].filter(Boolean).join('\n')

  const lensHint = step1.hasLensMatch
    ? `Google Lens previously identified this item as: "${step1.title}" (brand: ${step1.brand}, category: ${step1.category}).
Top lens matches: ${step1.lensMatches
        .slice(0, 5)
        .map((m) => m.title)
        .join('; ')}.`
    : 'Google Lens found no visual matches for this item -- identify it directly from the photo.'

  const prompt = `You are analyzing a product photo for a resale listing platform.

${lensHint}
${kgContext ? `\nGoogle Knowledge Graph:\n${kgContext}` : ''}
${correctionContext}

Analyze the photo carefully and extract the structured product information using the extract_product_info tool.

For sneakers specifically: always identify US size (from box label, insole tag, or visible markings) and gender (men's/women's, inferred from silhouette). Include both as explicit entries in notable_features even if the value is "unknown".

For the photo plan, generate an item-specific ordered shot checklist for the studio session. Shot order is the shoot sequence — the photographer takes them in this exact order. Assign every shot an \`order\` field (1-indexed).

Ordering principles (reason from these for this specific item — do not just copy a template):
1. Shot #1 is the listing thumbnail. It must be the single most compelling full-item image — the one that reads best at postage-stamp size and makes someone want to click. For a 3D item this is typically an angled front-corner hero shot; for a flat item it's a clean front flat. Never put a detail, close-up, damage, or accessory shot first.
2. Dimensionality drives the rotation. 3D items (bags, shoes, keyboards, watches, most electronics): hero → top-down → front → back → sides → bottom → then details, then accessories, then packaging. Flat items (clothing, flat wallets, slim pouches): front → back → details — NO overhead shot. The overhead and front flat show the same surface on a flat item; only include overhead when the item has real depth (>~2cm closed) that makes the top a distinct surface worth shooting separately. Adjust for in-between items.
3. Whole before part. Full-item shots before any detail or close-up. Establish shape and condition first.
4. Exterior before interior. After covering all exterior sides, reveal the inside (open compartments, card slots, box contents). Interior shots come after the exterior rotation and before detail close-ups. Only include if the item has an interior worth showing.
5. Details in descending importance. Brand/auth marks (stamp, date code, serial) → hardware → condition areas → damage (one shot per distinct area, only if present).
6. Accessories and inclusions after the item itself. One shot per accessory or all together if small. Packaging last (box closed, then open).
7. Item- and brand-specific reasoning. A luxury item with a dust bag, auth card, and receipt needs those explicitly ordered after the item. A watch with a display case back gets its own prominent shot. A bag with distinctive hardware should foreground that hardware earlier in the detail section. Apply brand-specific auth mark conventions (LV date codes, Chanel auth cards, Nike swoosh on outsole, etc.).

Category reference sequences (illustrative, not rigid — reason about this specific item):
- handbag/bag: angled hero → top-down → front flat → back flat → bottom → interior open → all hardware → brand stamp → date code → serial → strap/handle → damage areas → dust bag → auth card
- small_leather_goods (3D, has real gusset/depth — zip-around wallet, structured coin purse, rounded pouch): angled hero → front flat → back flat → interior (all slots) → brand/blind stamp → hardware → date code → damage → accessories
- small_leather_goods (flat/shallow — flat clutch, cardholder, slim bifold, envelope pouch with depth <~2cm): NO overhead; front flat (upright) → back flat → interior open (all slots/compartments) → brand stamp → hardware → damage → accessories. Overhead duplicates front flat and is omitted.
- sneakers: angled 3/4 hero (both shoes together, best face) → medial side → toe box → heel → insole with size → outsole → box label → hangtag/extras → damage
- watches: angled hero with watch in open box → full dial front-on → crown → case back (serial + movement if visible) → full band/bracelet → clasp → bezel → crystal edge → damage → papers/inner box
- clothing: front flat → back flat → brand tag → care/size label → material texture (if notable) → damage
- electronics: front powered on (home/boot screen) → back → all ports/sides → serial/IMEI → all accessories together → damage
- keyboards: angled 3/4 beauty shot (front-facing diagonal from above) → top-down full board → left side → right side → bottom → keycap legends close-up → switch stems → stabilizers → damage → box + accessories
- jewelry: angled hero if geometry allows (pendant hanging, ring on stand) → otherwise top-down full → back/clasp → brand/hallmark stamp → stone or detail close-up → scale reference → damage → box/pouch/certificate`

  let output: VisionOutput
  try {
    output = await runStructured<VisionOutput>({
      model: 'claude-sonnet-4-6',
      maxTokens: 2048,
      prompt,
      image: { url: publicPhotoUrl },
      apiKey: apiKeys.anthropic,
      toolName: 'extract_product_info',
      toolDescription: 'Extract structured product identification and analysis from the photo',
      jsonSchema: {
        type: 'object' as const,
        properties: {
          brand: { type: 'string', description: 'Confirmed brand name' },
          category: {
            type: 'string',
            enum: [
              'handbag',
              'small_leather_goods',
              'clothing',
              'sneakers',
              'electronics',
              'jewelry',
              'collectibles',
              'watches',
              'keyboards',
              'other',
            ],
          },
          condition: {
            type: 'string',
            enum: [
              'new_with_tags',
              'new_without_tags',
              'like_new',
              'very_good',
              'good',
              'fair',
              'poor',
              'for_parts',
            ],
            description: "Use 'new_with_tags' ONLY if original tags, hang tags, or price tags are physically visible in the photo or the item is still in sealed/original packaging with tags attached. If the item appears unused but no tags are visible, use 'new_without_tags'.",
          },
          condition_notes: {
            type: 'string',
            description: 'Specific condition details visible in this photo. Be accurate and precise — describe exactly where wear appears and what areas are in good condition. Write from a marketplace seller perspective: be specific about location and severity (e.g. "minor scuffs on white rubber outsole near heel" not "heavy wear throughout"). Note what is clean and intact alongside what shows wear. Never use vague language like "general soiling", "wear throughout", or "heavily" unless the damage is clearly severe and widespread across multiple areas. Only describe what you can definitively see.',
          },
          notable_features: {
            type: 'array',
            items: { type: 'string' },
            description: 'Key attributes listed as short strings. The FIRST entry MUST be "Model: <exact model name>" — use the most specific name you can identify from the photo and Lens data (e.g., "Model: Monogram Giant Escal Cosmetic Pouch" not "Model: handbag"). If the collection or year is identifiable, include it: "Collection: Spring/Summer 2020". Then add color, hardware, material, colorway, size, etc. For sneakers you MUST also include: (1) "Size: US X" — read from box label, insole, or visible markings, use "Size: unknown" if not visible; (2) "Gender: men\'s" or "Gender: women\'s" — infer from silhouette, use "Gender: unknown" if unclear.',
          },
          inclusions: {
            type: 'array',
            items: INCLUSIONS_ITEM_SCHEMA,
            description: buildInclusionsDescription(checklist),
          },
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
              },
              required: ['shot', 'description', 'required', 'photo_type', 'order'],
            },
            description: 'Ordered studio shot checklist specific to this item. Shot order is the shoot sequence; shot #1 is the listing thumbnail.',
          },
          confidence_note: {
            type: 'string',
            description:
              'Brief note on identification confidence (e.g. "High — clear brand stamp visible")',
          },
        },
        required: [
          'brand',
          'category',
          'condition',
          'condition_notes',
          'notable_features',
          'inclusions',
          'photo_plan',
          'confidence_note',
        ],
      },
    })
  } catch (err) {
    if (err instanceof ClaudeStructuredOutputError) {
      throw new Error('step2: Claude did not return a tool_use block')
    }
    throw err
  }

  console.log('[step2] Claude responded')
  const isLuxury = LUXURY_BRANDS.has(output.brand)

  await pushPipelineStep(listingId, {
    pipeline_step: 2,
    status: 'id_gate',
    brand: output.brand,
    category: output.category,
    condition: output.condition,
    condition_notes: output.condition_notes,
    is_luxury: isLuxury,
    inclusions: mergeDetectedInclusions([], output.inclusions),
    photo_plan: output.photo_plan,
    photo_plan_generated_at: new Date().toISOString(),
    intake_meta: {
      lensMatches: step1.lensMatches,
      visionAnalysis: output,
      corrections,
    },
  })

  console.log(`[step2] complete: brand=${output.brand} category=${output.category}`)
  return {
    ok: true,
    brand: output.brand,
    category: output.category,
    condition: output.condition,
    conditionNotes: output.condition_notes,
    notableFeatures: output.notable_features,
    isLuxury,
    inclusions: mergeDetectedInclusions([], output.inclusions),
    photoPlan: output.photo_plan,
    confidenceNote: output.confidence_note,
  }
}
