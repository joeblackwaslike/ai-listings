#!/usr/bin/env tsx
/**
 * Migrates 98 listings from the old flat poshmark category format to the new
 * { department, category, subcategory } format expected by buildUnifiedListingForPoshmark.
 *
 * Usage:
 *   source .env.local && tsx scripts/migrate-poshmark-categories.ts
 *   tsx scripts/migrate-poshmark-categories.ts --dry-run
 */

import { createClient } from '@supabase/supabase-js'
import { POSHMARK_CATEGORY_MAP } from '../src/lib/platforms/poshmark-categories'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const DRY_RUN = process.argv.includes('--dry-run')

interface CategoryFields {
  department: string
  category: string
  subcategory?: string
}

// Maps old flat category string to new department/category/subcategory fields.
// For 'Electronics', mapping is resolved per-item using listing.category.
const CATEGORY_MAP: Record<string, CategoryFields> = {
  'Handbags': { department: 'Women', category: 'Bags' },
  'Sneakers': { department: 'Women', category: 'Shoes', subcategory: 'Sneakers' },
  'Women / Shoes / Sneakers': { department: 'Women', category: 'Shoes', subcategory: 'Sneakers' },
  'Accessories': { department: 'Women', category: 'Accessories' },
  'Jewelry > Necklaces': { department: 'Women', category: 'Jewelry', subcategory: 'Necklaces' },
  'Women / Bags / Wallets': { department: 'Women', category: 'Bags', subcategory: 'Wallets' },
  'Jewelry': { department: 'Women', category: 'Jewelry' },
  'Women / Accessories / Wallets': { department: 'Women', category: 'Bags', subcategory: 'Wallets' },
  'Accessories/Watches': { department: 'Women', category: 'Accessories', subcategory: 'Watches' },
  'Men / Accessories / Wallets & Money Clips': { department: 'Men', category: 'Accessories', subcategory: 'Key & Card Holders' },
  'Accessories/Wallets': { department: 'Women', category: 'Bags', subcategory: 'Wallets' },
  'Handbags / Small Leather Goods': { department: 'Women', category: 'Bags', subcategory: 'Wallets' },
  'Jewelry > Rings': { department: 'Women', category: 'Jewelry', subcategory: 'Rings' },
  'Shoes / Sneakers': { department: 'Women', category: 'Shoes', subcategory: 'Sneakers' },
  'Women / Bags / Handbags': { department: 'Women', category: 'Bags' },
  'Women / Jewelry / Necklaces': { department: 'Women', category: 'Jewelry', subcategory: 'Necklaces' },
  'Men / Accessories / Wallets': { department: 'Men', category: 'Accessories', subcategory: 'Key & Card Holders' },
  'Handbags > Tote Bags': { department: 'Women', category: 'Bags', subcategory: 'Totes' },
  "Men's Accessories": { department: 'Men', category: 'Accessories' },
  "Women's Watches": { department: 'Women', category: 'Accessories', subcategory: 'Watches' },
  'Small Leather Goods': { department: 'Women', category: 'Bags', subcategory: 'Wallets' },
  'Handbags > Crossbody Bags': { department: 'Women', category: 'Bags', subcategory: 'Crossbody Bags' },
  'Women / Accessories / Bags / Wallets': { department: 'Women', category: 'Bags', subcategory: 'Wallets' },
  'Accessories > Watches': { department: 'Women', category: 'Accessories', subcategory: 'Watches' },
  'Women / Accessories / Watches': { department: 'Women', category: 'Accessories', subcategory: 'Watches' },
  'Women / Bags / Backpacks': { department: 'Women', category: 'Bags', subcategory: 'Backpacks' },
  'Women/Bags/Clutches': { department: 'Women', category: 'Bags', subcategory: 'Clutches & Wristlets' },
  'Accessories / Jewelry / Bracelets': { department: 'Women', category: 'Jewelry', subcategory: 'Bracelets' },
  'Accessories > Wallets': { department: 'Women', category: 'Bags', subcategory: 'Wallets' },
  'Women/Bags/Wallets': { department: 'Women', category: 'Bags', subcategory: 'Wallets' },
  'Women/Bags/Wallets & Card Holders': { department: 'Women', category: 'Bags', subcategory: 'Wallets' },
  'Women / Bags / Wallets & Cases': { department: 'Women', category: 'Bags', subcategory: 'Wallets' },
  'Jewelry & Accessories/Watches': { department: 'Women', category: 'Accessories', subcategory: 'Watches' },
  'Jewelry > Bracelets': { department: 'Women', category: 'Jewelry', subcategory: 'Bracelets' },
  'Handbags / Wallets': { department: 'Women', category: 'Bags', subcategory: 'Wallets' },
  'Women / Handbags / Backpacks': { department: 'Women', category: 'Bags', subcategory: 'Backpacks' },
}

function resolveElectronics(listingCategory: string): CategoryFields {
  if (listingCategory === 'keyboards') {
    return { department: 'Electronics', category: 'Computers, Laptops & Parts', subcategory: 'Keyboards' }
  }
  return { department: 'Electronics', category: 'Computers, Laptops & Parts' }
}

function toCategoryPath(fields: CategoryFields): string {
  const parts = [fields.department, fields.category]
  if (fields.subcategory) parts.push(fields.subcategory)
  return parts.join('/')
}

async function main() {
  if (DRY_RUN) console.log('[dry-run] No writes will be made.\n')

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

  // Supabase JS doesn't support "key exists but nested key doesn't" easily,
  // so fetch all listings with poshmark fields and filter in JS
  const { data: allWithPoshmark, error: err2 } = await supabase
    .from('listings')
    .select('id, sku, category, platform_fields')
    .not('platform_fields->poshmark', 'is', null)

  if (err2) throw err2

  const affected = (allWithPoshmark ?? []).filter((row) => {
    const pm = (row.platform_fields as Record<string, unknown>)?.poshmark as Record<string, unknown> | null
    return pm && !pm.department
  })

  console.log(`Found ${affected.length} listings to migrate.\n`)

  let updated = 0
  let skipped = 0

  for (const row of affected) {
    const pm = ((row.platform_fields as Record<string, unknown>).poshmark as Record<string, unknown>)
    const oldCategory = pm.category as string

    let newFields: CategoryFields
    if (oldCategory === 'Electronics') {
      newFields = resolveElectronics(row.category as string)
    } else {
      const mapped = CATEGORY_MAP[oldCategory]
      if (!mapped) {
        console.warn(`  SKIP ${row.sku}: no mapping for "${oldCategory}"`)
        skipped++
        continue
      }
      newFields = mapped
    }

    const path = toCategoryPath(newFields)
    if (!POSHMARK_CATEGORY_MAP[path]) {
      console.warn(`  SKIP ${row.sku}: path "${path}" not in POSHMARK_CATEGORY_MAP`)
      skipped++
      continue
    }

    const updatedPm = {
      ...pm,
      department: newFields.department,
      category: newFields.category,
      ...(newFields.subcategory ? { subcategory: newFields.subcategory } : { subcategory: undefined }),
    }
    // Remove subcategory key entirely if not applicable
    if (!newFields.subcategory) delete updatedPm.subcategory

    const updatedPlatformFields = {
      ...(row.platform_fields as Record<string, unknown>),
      poshmark: updatedPm,
    }

    console.log(`  ${DRY_RUN ? '[dry]' : '    '} ${row.sku}: "${oldCategory}" → ${path}`)

    if (!DRY_RUN) {
      const { error: updateError } = await supabase
        .from('listings')
        .update({ platform_fields: updatedPlatformFields })
        .eq('id', row.id)
      if (updateError) {
        console.error(`  ERROR ${row.sku}: ${updateError.message}`)
        skipped++
        continue
      }
    }
    updated++
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
