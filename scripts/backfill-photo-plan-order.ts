#!/usr/bin/env tsx
/**
 * Backfills ordered photo_plan for active listings that predate the ordering feature.
 * Calls Claude Haiku to re-generate a properly ordered shot list for each listing.
 *
 * Usage:
 *   tsx scripts/backfill-photo-plan-order.ts                   # all active non-archived
 *   tsx scripts/backfill-photo-plan-order.ts --listing-id <id>  # single listing (test)
 *   tsx scripts/backfill-photo-plan-order.ts --dry-run          # print diffs, no writes
 */

import { createClient } from '@supabase/supabase-js'
import { generatePhotoPlan } from '../src/lib/pipeline/generate-photo-plan'
import type { Inclusion, PhotoShot, ListingCategory } from '../src/types/listings'

// env loaded from shell: source .env.local before running

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!

if (!SUPABASE_URL || !SUPABASE_KEY || !ANTHROPIC_KEY) {
  console.error('Missing required env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const args = process.argv.slice(2)
const listingIdArg = args.find((a, i) => a === '--listing-id' && args[i + 1])
const singleId = listingIdArg ? args[args.indexOf('--listing-id') + 1] : null
const dryRun = args.includes('--dry-run')

function alreadyOrdered(plan: PhotoShot[]): boolean {
  return plan.length > 0 && plan[0].order != null
}

function diffPlan(before: PhotoShot[], after: PhotoShot[]): string {
  const maxLen = Math.max(before.length, after.length)
  const lines: string[] = []
  for (let i = 0; i < maxLen; i++) {
    const b = before[i]
    const a = after[i]
    if (!b) {
      lines.push(`  + [${a.order}] ${a.shot}`)
    } else if (!a) {
      lines.push(`  - [?] ${b.shot}`)
    } else if (b.shot !== a.shot || b.order !== a.order) {
      lines.push(`  ~ [${b.order ?? '?'} → ${a.order}] ${b.shot} → ${a.shot}`)
    } else {
      lines.push(`    [${a.order}] ${a.shot}`)
    }
  }
  return lines.join('\n')
}

function notableFeaturesOf(intakeMeta: Record<string, unknown> | null): string[] {
  const va = (intakeMeta as { visionAnalysis?: { notable_features?: string[] } } | null)?.visionAnalysis
  return va?.notable_features ?? []
}

async function processListing(listing: {
  id: string
  sku: string | null
  category: string | null
  brand: string | null
  intake_meta: Record<string, unknown> | null
  inclusions: Inclusion[] | null
  photo_plan: PhotoShot[] | null
}) {
  const plan = listing.photo_plan ?? []
  if (plan.length === 0) {
    console.log(`  SKIP (empty plan)`)
    return
  }
  if (alreadyOrdered(plan)) {
    console.log(`  SKIP (already ordered, shot 1 = "${plan[0].shot}")`)
    return
  }

  const newPlan = await generatePhotoPlan({
    category: (listing.category ?? 'other') as ListingCategory,
    brand: listing.brand ?? '',
    notableFeatures: notableFeaturesOf(listing.intake_meta),
    inclusions: listing.inclusions ?? [],
    anthropicKey: ANTHROPIC_KEY,
  })

  console.log(diffPlan(plan, newPlan))

  if (!dryRun) {
    const { error } = await supabase
      .from('listings')
      .update({
        photo_plan: newPlan,
        photo_plan_generated_at: new Date().toISOString(),
      })
      .eq('id', listing.id)

    if (error) {
      console.error(`  ERROR writing: ${error.message}`)
    } else {
      console.log(`  WRITTEN`)
    }
  } else {
    console.log(`  DRY RUN — not written`)
  }
}

async function main() {
  let query = supabase
    .from('listings')
    .select('id, sku, category, brand, intake_meta, inclusions, photo_plan')
    .neq('status', 'archived')
    .not('photo_plan', 'is', null)

  if (singleId) {
    query = query.eq('id', singleId)
  }

  const { data: listings, error } = await query
  if (error) {
    console.error('Failed to fetch listings:', error.message)
    process.exit(1)
  }
  if (!listings || listings.length === 0) {
    console.log('No listings to process.')
    return
  }

  console.log(`Processing ${listings.length} listing(s)${dryRun ? ' (DRY RUN)' : ''}...\n`)

  for (const listing of listings) {
    console.log(`\n[${listing.sku ?? listing.id}] ${listing.brand ?? ''} ${listing.category ?? ''}`)
    try {
      await processListing(listing as unknown as Parameters<typeof processListing>[0])
    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.log('\nDone.')
}

main()
