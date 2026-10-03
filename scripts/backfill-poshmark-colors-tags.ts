#!/usr/bin/env tsx
/**
 * Backfills missing poshmark colors, style_tags for active listings.
 * Also generates full poshmark fields for listings that have none.
 *
 * Usage:
 *   source .env.local && tsx scripts/backfill-poshmark-colors-tags.ts
 *   tsx scripts/backfill-poshmark-colors-tags.ts --dry-run
 *   tsx scripts/backfill-poshmark-colors-tags.ts --id <listing-id>
 */

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!
const DRY_RUN = process.argv.includes('--dry-run')
const idIdx = process.argv.indexOf('--id')
const SINGLE_ID = idIdx !== -1 ? process.argv[idIdx + 1] : null

const COLORS = 'Black, White, Gray, Red, Pink, Orange, Yellow, Green, Blue, Purple, Brown, Tan, Beige, Gold, Silver, Cream, Nude, Multicolor'

// Color keywords → Poshmark canonical color (checked in order; first match wins per slot)
const COLOR_KEYWORDS: Array<[RegExp, string]> = [
  [/\bneon\s+green\b|\bgreen\b/i, 'Green'],
  [/\bneon\s+multi|\bmulticolor|\btie-dye|\bpastel\b|\brainbow\b|\bkaleidoscope\b/i, 'Multicolor'],
  [/\bblack\b/i, 'Black'],
  [/\bwhite\b/i, 'White'],
  [/\bgrey\b|\bgray\b/i, 'Gray'],
  [/\bpink\b|\brose\b|\bfuchsia\b/i, 'Pink'],
  [/\bneon\b/i, 'Multicolor'],
  [/\bred\b|\bwine\b|\bburgund\b/i, 'Red'],
  [/\borange\b/i, 'Orange'],
  [/\byellow\b|\bcitrus\b/i, 'Yellow'],
  [/\bblue\b|\bnavy\b|\bcobalt\b|\bsapphire\b|\bindigo\b/i, 'Blue'],
  [/\bpurple\b|\bviolet\b|\blilac\b|\blavender\b/i, 'Purple'],
  [/\bbrown\b|\btan\b|\bcamel\b|\bcognac\b|\bchestnut\b/i, 'Brown'],
  [/\bbeige\b|\bcream\b|\bivory\b|\becru\b|\bnude\b/i, 'Beige'],
  [/\bgold\b/i, 'Gold'],
  [/\bsilver\b|\bsterling\b|\bplatinum\b/i, 'Silver'],
]

// Category keywords → style tags
const CATEGORY_STYLE_MAP: Record<string, string[]> = {
  sneaker: ['Streetwear', 'Casual', 'Luxury'],
  boot: ['Edgy', 'Luxury', 'Streetwear'],
  wallet: ['Luxury', 'Minimalist', 'Classic'],
  card: ['Luxury', 'Minimalist', 'Classic'],
  necklace: ['Luxury', 'Minimalist', 'Classic'],
  bag: ['Luxury', 'Classic', 'Designer'],
  tote: ['Luxury', 'Classic', 'Designer'],
  watch: ['Luxury', 'Classic', 'Minimalist'],
  bangle: ['Luxury', 'Minimalist', 'Classic'],
  backpack: ['Luxury', 'Casual', 'Streetwear'],
  keyboard: ['Streetwear', 'Edgy', 'Casual'],
  default: ['Luxury', 'Classic', 'Designer'],
}

function inferColors(title: string): string[] {
  const colors: string[] = []
  for (const [regex, color] of COLOR_KEYWORDS) {
    if (regex.test(title) && !colors.includes(color)) {
      colors.push(color)
      if (colors.length === 2) break
    }
  }
  return colors.length > 0 ? colors : ['Black']
}

function inferStyleTags(title: string): string[] {
  const lower = title.toLowerCase()
  for (const [kw, tags] of Object.entries(CATEGORY_STYLE_MAP)) {
    if (lower.includes(kw)) return tags
  }
  return CATEGORY_STYLE_MAP.default
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY })

interface Listing {
  id: string
  title: string
  description: string
  condition: string
  platform_fields: Record<string, unknown>
}

function generateColorsAndTags(listing: Listing): { colors: string[]; style_tags: string[] } {
  return {
    colors: inferColors(listing.title),
    style_tags: inferStyleTags(listing.title),
  }
}

// Map title keywords to Poshmark category path
function inferCategory(title: string): string {
  const t = title.toLowerCase()
  if (t.includes('sneaker') || t.includes('trainer')) return 'Women/Shoes/Sneakers'
  if (t.includes('boot')) return 'Women/Shoes/Boots'
  if (t.includes('necklace') || t.includes('pendant') || t.includes('station necklace')) return 'Women/Accessories/Necklaces'
  if (t.includes('bangle') || t.includes('bracelet') || t.includes('ring')) return 'Women/Accessories/Jewelry'
  if (t.includes('wallet') || t.includes('card holder') || t.includes('coin') || t.includes('organizer')) return 'Women/Bags/Wallets'
  if (t.includes('tote') || t.includes('bag') || t.includes('backpack') || t.includes('rucksack') || t.includes('pochette') || t.includes('woc')) return 'Women/Bags/Handbags'
  if (t.includes('key case') || t.includes('key holder')) return 'Women/Accessories/Key & Card Holders'
  if (t.includes('watch')) return 'Men/Accessories/Watches'
  if (t.includes('keyboard') || t.includes('maschine')) return 'Electronics/Gaming/Other'
  return 'Women/Bags/Handbags'
}

function inferSize(title: string): string {
  const sizeMatch = title.match(/\bUS\s*(\d[\d.]*)\b/i) ?? title.match(/\bWomen'?s\s+(\d[\d.]*)\b/i)
  if (sizeMatch) return sizeMatch[1]
  const letterMatch = title.match(/\b(XS|S|M|L|XL|XXL)\b/)
  if (letterMatch) return letterMatch[1]
  return 'OS'
}

function generateFullPoshmarkFields(listing: Listing): Record<string, unknown> {
  const ebayData = listing.platform_fields?.ebay as Record<string, unknown> | undefined
  const description = (listing.description ?? (ebayData?.description as string | undefined) ?? '').substring(0, 800)
  const title = listing.title.substring(0, 80)

  return {
    title,
    description,
    category: inferCategory(listing.title),
    size: inferSize(listing.title),
    colors: inferColors(listing.title),
    style_tags: inferStyleTags(listing.title),
  }
}

async function main() {
  let query = supabase
    .from('listings')
    .select('id, title, description, condition, platform_fields')
    .neq('status', 'archived')

  if (SINGLE_ID) {
    query = query.eq('id', SINGLE_ID)
  }

  const { data: listings, error } = await query
  if (error) throw error

  const needsColorsTags = listings!.filter(
    (l) =>
      l.platform_fields?.poshmark &&
      (!l.platform_fields.poshmark.colors || !l.platform_fields.poshmark.style_tags)
  )
  const needsFullPoshmark = listings!.filter((l) => !l.platform_fields?.poshmark)

  console.log(`Listings needing colors+tags: ${needsColorsTags.length}`)
  console.log(`Listings needing full poshmark fields: ${needsFullPoshmark.length}`)

  let updated = 0
  let failed = 0

  for (const listing of needsColorsTags) {
    process.stdout.write(`  ${listing.title.substring(0, 60)}… `)
    try {
      const { colors, style_tags } = generateColorsAndTags(listing as Listing)
      if (DRY_RUN) {
        console.log(`[DRY] colors=${JSON.stringify(colors)} tags=${JSON.stringify(style_tags)}`)
        continue
      }
      const updated_pm = { ...listing.platform_fields.poshmark as object, colors, style_tags }
      const { error } = await supabase
        .from('listings')
        .update({ platform_fields: { ...listing.platform_fields, poshmark: updated_pm } })
        .eq('id', listing.id)
      if (error) throw error
      console.log(`✓ colors=${JSON.stringify(colors)}`)
      updated++
    } catch (err) {
      console.log(`✗ ${(err as Error).message}`)
      failed++
    }
  }

  for (const listing of needsFullPoshmark) {
    process.stdout.write(`  [FULL] ${listing.title.substring(0, 55)}… `)
    try {
      const pm = generateFullPoshmarkFields(listing as Listing)
      if (DRY_RUN) {
        console.log(`[DRY] ${JSON.stringify(pm).substring(0, 120)}`)
        continue
      }
      const { error } = await supabase
        .from('listings')
        .update({ platform_fields: { ...listing.platform_fields, poshmark: pm } })
        .eq('id', listing.id)
      if (error) throw error
      console.log(`✓ category=${pm.category}`)
      updated++
    } catch (err) {
      console.log(`✗ ${(err as Error).message}`)
      failed++
    }
  }

  console.log(`\nDone: ${updated} updated, ${failed} failed${DRY_RUN ? ' (dry run)' : ''}`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
