import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSettings } from '@/lib/user-settings'
import { PlatformSettings } from '@/components/settings/PlatformSettings'

const PLATFORM_KEYS = [
  'reddit_username',
  'us_state',
  'imgur_access_token',
  'reddit_refresh_token',
  'poshmark_cookies',
  'mercari_api_token',
  'etsy_access_token',
  'ebay_refresh_token',
  'apify_api_token',
]

export default async function PlatformsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const existingSettings = await getSettings(user.id, PLATFORM_KEYS)

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="flex items-center gap-3 px-6 py-3 border-b border-gray-800">
        <a href="/dashboard" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
          ← Dashboard
        </a>
        <span className="text-gray-800">/</span>
        <a href="/settings" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
          Settings
        </a>
        <span className="text-gray-800">/</span>
        <span className="text-xs text-gray-500">Platforms</span>
      </header>

      <div className="max-w-lg mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-100">Platform Credentials</h1>
          <p className="text-xs text-gray-600 mt-1">
            Configure credentials for each resale platform. Credentials are stored securely and never
            returned to the browser after saving.
          </p>
        </div>

        <PlatformSettings existingSettings={existingSettings} />
      </div>
    </div>
  )
}
