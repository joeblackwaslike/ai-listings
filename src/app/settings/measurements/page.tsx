import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSetting } from '@/lib/user-settings'
import { MeasurementSettings } from '@/components/settings/MeasurementSettings'

export default async function MeasurementSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let inputUnit: 'imperial' | 'metric' = 'imperial'
  try {
    const unit = await getSetting(user.id, 'measurement_input_unit')
    inputUnit = unit === 'metric' ? 'metric' : 'imperial'
  } catch (err) {
    console.error(`Failed to read measurement_input_unit for user ${user.id}:`, err)
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="flex items-center gap-3 px-6 py-3 border-b border-gray-800">
        <a href="/settings" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
          ← Settings
        </a>
        <span className="text-gray-800">/</span>
        <span className="text-xs text-gray-500">Measurement Units</span>
      </header>

      <div className="max-w-lg mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-100">Measurement Units</h1>
          <p className="text-xs text-gray-600 mt-1">
            Choose how you enter measurements on the gate form. Every listing always shows both
            units once entered.
          </p>
        </div>

        <div className="rounded-xl border border-gray-800 px-5 py-4">
          <MeasurementSettings initialInputUnit={inputUnit} />
        </div>
      </div>
    </div>
  )
}
