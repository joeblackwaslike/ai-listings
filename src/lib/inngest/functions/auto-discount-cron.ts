import { inngest } from '@/lib/inngest/client'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

export const autoDiscountCron = inngest.createFunction(
  {
    id: 'auto-discount-cron',
    name: 'Auto-Discount Cron',
    triggers: [{ cron: '0 8 * * *' }], // 8 AM UTC daily
  },
  async ({ step }) => {
    const results = await step.run('apply-discounts', async () => {
      const supabase = getSupabaseAdmin()

      // 1. Get all published listings
      const { data: listings } = await supabase
        .from('listings')
        .select(
          'id, user_id, final_price_cents, suggested_price_cents, auto_discount_enabled, auto_discount_pct, auto_discount_interval_days'
        )
        .eq('status', 'published')

      if (!listings?.length) return { processed: 0, discounted: 0 }

      // 2. Get global settings for all distinct users
      const userIds = [...new Set(listings.map((l) => l.user_id as string))]
      const { data: globalSettings } = await supabase
        .from('user_settings')
        .select('user_id, setting_key, setting_value')
        .in('user_id', userIds)
        .in('setting_key', [
          'auto_discount_enabled',
          'auto_discount_pct',
          'auto_discount_interval_days',
          'auto_discount_floor_pct',
        ])

      // Build settings map: userId → resolved settings
      const settingsMap: Record<string, { enabled: boolean; pct: number; intervalDays: number; floorPct: number }> = {}
      for (const row of globalSettings ?? []) {
        const uid = row.user_id as string
        if (!settingsMap[uid]) {
          settingsMap[uid] = { enabled: false, pct: 10, intervalDays: 14, floorPct: 50 }
        }
        const s = settingsMap[uid]
        if (row.setting_key === 'auto_discount_enabled') s.enabled = row.setting_value === 'true'
        if (row.setting_key === 'auto_discount_pct') s.pct = parseFloat(row.setting_value as string) || 10
        if (row.setting_key === 'auto_discount_interval_days') s.intervalDays = parseInt(row.setting_value as string, 10) || 14
        if (row.setting_key === 'auto_discount_floor_pct') s.floorPct = parseFloat(row.setting_value as string) || 50
      }

      let discounted = 0

      for (const listing of listings) {
        try {
          const global = settingsMap[listing.user_id as string] ?? { enabled: false, pct: 10, intervalDays: 14, floorPct: 50 }

          // Per-listing overrides (null = use global)
          const enabled = (listing.auto_discount_enabled as boolean | null) ?? global.enabled
          if (!enabled) continue

          const pct = (listing.auto_discount_pct as number | null) ?? global.pct
          const intervalDays = (listing.auto_discount_interval_days as number | null) ?? global.intervalDays
          const floorPct = global.floorPct // floor always from global

          // Check last price event date
          const { data: lastEvent } = await supabase
            .from('listing_price_events')
            .select('price_cents, created_at')
            .eq('listing_id', listing.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single()

          if (!lastEvent) continue

          const daysSinceLastEvent =
            (Date.now() - new Date(lastEvent.created_at as string).getTime()) / (1000 * 60 * 60 * 24)
          if (Math.floor(daysSinceLastEvent) < intervalDays) continue

          // Get initial price for floor calculation
          const { data: initialEvent } = await supabase
            .from('listing_price_events')
            .select('price_cents')
            .eq('listing_id', listing.id)
            .eq('event_type', 'initial')
            .order('created_at', { ascending: true })
            .limit(1)
            .single()

          const initialPrice = (initialEvent?.price_cents as number | null) ?? (listing.suggested_price_cents as number | null) ?? 0
          if (initialPrice <= 0) continue
          const currentPrice = (listing.final_price_cents as number | null) ?? (listing.suggested_price_cents as number | null) ?? 0
          if (currentPrice <= 0) continue

          const newPrice = Math.round(currentPrice * (1 - pct / 100))
          const floorPrice = Math.round(initialPrice * (floorPct / 100))

          if (newPrice < floorPrice) continue // floor protection

          // Apply discount
          await supabase
            .from('listings')
            .update({ final_price_cents: newPrice })
            .eq('id', listing.id)

          await supabase.from('listing_price_events').insert({
            listing_id: listing.id,
            event_type: 'auto_discount',
            price_cents: newPrice,
            note: `Auto-discounted ${pct}% — was $${(currentPrice / 100).toFixed(0)}, now $${(newPrice / 100).toFixed(0)}`,
          })

          await supabase.from('notifications').insert({
            user_id: listing.user_id,
            type: 'auto_discount',
            title: 'Auto-discount applied',
            body: `Your listing was discounted ${pct}% to $${(newPrice / 100).toFixed(0)}`,
            listing_id: listing.id,
            read: false,
          })

          discounted++
        } catch (err) {
          console.error(`auto-discount: error processing listing ${listing.id as string}:`, err)
          // continue to next listing
        }
      }

      return { processed: listings.length, discounted }
    })

    return results
  },
)
