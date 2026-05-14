import Anthropic from '@anthropic-ai/sdk'
import type { ListingCategory, ConditionValue, PhotoShot, Inclusion } from '@/types/listings'
import type { ProductIdData } from './step1-product-id'
import { pushPipelineStep } from './supabase-push'
import type { ApiKeys } from '@/lib/user-api-keys'
import { toPublicUrl } from './to-public-url'

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
])

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
  inclusions: Array<{ item: string; included: boolean; notes: string | null }>
  photo_plan: Array<{
    shot: string
    description: string
    required: boolean
    photo_type: 'intake' | 'processed' | 'auth_card' | 'studio'
  }>
  confidence_note: string
}

export async function runStep2VisionAnalysis(
  listingId: string,
  photoUrl: string,
  step1: ProductIdData,
  corrections: string | null = null,
  apiKeys: ApiKeys
): Promise<VisionAnalysis> {
  console.log(`[step2] starting vision analysis for listing ${listingId}`)
  const client = new Anthropic({ apiKey: apiKeys.anthropic })
  const publicPhotoUrl = await toPublicUrl(photoUrl)
  console.log(`[step2] public photo URL: ${publicPhotoUrl}, calling Claude...`)

  const correctionContext = corrections
    ? `\n\nUSER CORRECTION: The previous identification was wrong. The user says: "${corrections}". Prioritize this correction.`
    : ''

  const prompt = `You are analyzing a product photo for a resale listing platform.

Google Lens previously identified this item as: "${step1.title}" (brand: ${step1.brand}, category: ${step1.category}).
Top lens matches: ${step1.lensMatches
    .slice(0, 3)
    .map((m) => m.title)
    .join('; ')}.
${correctionContext}

Analyze the photo carefully and extract the structured product information using the extract_product_info tool.

For the photo plan, generate an item-specific shot checklist for the studio session. Examples by category:
- handbag: front flat, back flat, bottom, interior open, all hardware close-up, brand stamp, date code, auth card, serial number, strap, zipper pulls, any damage areas
- sneakers: side profile (both shoes), toe box, heel, insole, box label, hangtag, any creasing or scuffs
- electronics: front powered off, front powered on (boot/home screen), back, all ports, serial/IMEI label, all accessories, any damage
- clothing: front flat, back flat, brand tag, care label, measurement reference, any wear/damage`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    tools: [
      {
        name: 'extract_product_info',
        description: 'Extract structured product identification and analysis from the photo',
        input_schema: {
          type: 'object' as const,
          properties: {
            brand: { type: 'string', description: 'Confirmed brand name' },
            category: {
              type: 'string',
              enum: [
                'handbag',
                'clothing',
                'sneakers',
                'electronics',
                'jewelry',
                'collectibles',
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
            },
            condition_notes: {
              type: 'string',
              description: 'Specific condition details visible in this photo',
            },
            notable_features: {
              type: 'array',
              items: { type: 'string' },
              description: 'Key attributes: size, color, hardware, model number, colorway, etc.',
            },
            inclusions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  item: { type: 'string' },
                  included: { type: 'boolean' },
                  notes: { type: 'string', nullable: true },
                },
                required: ['item', 'included', 'notes'],
              },
              description: 'Items visible alongside the product (box, dust bag, auth card, etc.)',
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
                },
                required: ['shot', 'description', 'required', 'photo_type'],
              },
              description: 'Studio shot checklist specific to this item',
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
      },
    ],
    tool_choice: { type: 'tool', name: 'extract_product_info' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'url', url: publicPhotoUrl },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
  })

  console.log(`[step2] Claude responded, stop_reason=${response.stop_reason}`)
  const toolUse = response.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('step2: Claude did not return a tool_use block')
  }

  const output = toolUse.input as VisionOutput
  const isLuxury = LUXURY_BRANDS.has(output.brand)

  await pushPipelineStep(listingId, {
    pipeline_step: 2,
    status: 'id_gate',
    brand: output.brand,
    category: output.category,
    condition: output.condition,
    condition_notes: output.condition_notes,
    is_luxury: isLuxury,
    inclusions: output.inclusions,
    photo_plan: output.photo_plan,
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
    inclusions: output.inclusions,
    photoPlan: output.photo_plan,
    confidenceNote: output.confidence_note,
  }
}
