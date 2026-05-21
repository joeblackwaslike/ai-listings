import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSettings } from '@/lib/user-settings'
import { AutoDiscountSettings } from '@/components/settings/AutoDiscountSettings'

const DEFAULTS = {
  enabled: false,
  pct: 10,
  intervalDays: 14,
  floorPct: 50,
}

export default async function AutoDiscountPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const settings = await getSettings(user.id, [
    'auto_discount_enabled',
    'auto_discount_pct',
    'auto_discount_interval_days',
    'auto_discount_floor_pct',
  ])

  const enabled = settings['auto_discount_enabled'] != null
    ? settings['auto_discount_enabled'] === 'true'
    : DEFAULTS.enabled
  const pct = settings['auto_discount_pct'] != null
    ? parseFloat(settings['auto_discount_pct']) || DEFAULTS.pct
    : DEFAULTS.pct
  const intervalDays = settings['auto_discount_interval_days'] != null
    ? parseInt(settings['auto_discount_interval_days'], 10) || DEFAULTS.intervalDays
    : DEFAULTS.intervalDays
  const floorPct = settings['auto_discount_floor_pct'] != null
    ? parseFloat(settings['auto_discount_floor_pct']) || DEFAULTS.floorPct
    : DEFAULTS.floorPct

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="flex items-center gap-3 px-6 py-3 border-b border-gray-800">
        <a href="/settings" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
          ← Settings
        </a>
        <span className="text-gray-800">/</span>
        <span className="text-xs text-gray-500">Auto-Discount</span>
      </header>

      <div className="max-w-lg mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-100">Auto-Discount</h1>
          <p className="text-xs text-gray-600 mt-1">
            Scheduled price reductions to move stale inventory. Runs daily at 8 AM UTC.
          </p>
        </div>

        <div className="rounded-xl border border-gray-800 px-5 py-4">
          <AutoDiscountSettings
            initialEnabled={enabled}
            initialPct={pct}
            initialIntervalDays={intervalDays}
            initialFloorPct={floorPct}
          />
        </div>

        <p className="text-[10px] text-gray-700">
          Per-listing overrides can be set from the listing workspace. The floor % always comes
          from this global setting.
        </p>
      </div>
    </div>
  )
}
