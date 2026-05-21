import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="flex items-center gap-3 px-6 py-3 border-b border-gray-800">
        <a href="/dashboard" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
          ← Dashboard
        </a>
        <span className="text-gray-800">/</span>
        <span className="text-xs text-gray-500">Settings</span>
      </header>

      <div className="max-w-lg mx-auto px-6 py-8 space-y-3">
        <h1 className="text-lg font-semibold text-gray-100 mb-6">Settings</h1>

        <a
          href="/settings/api-keys"
          className="flex items-center justify-between rounded-xl border border-gray-800 px-5 py-4 hover:border-gray-700 transition-colors group"
        >
          <div>
            <p className="text-sm font-medium text-gray-200">API Keys</p>
            <p className="text-[11px] text-gray-600 mt-0.5">
              Anthropic, SerpAPI, WithoutBG and other service keys
            </p>
          </div>
          <span className="text-gray-700 group-hover:text-gray-500 transition-colors">→</span>
        </a>

        <a
          href="/settings/platforms"
          className="flex items-center justify-between rounded-xl border border-gray-800 px-5 py-4 hover:border-gray-700 transition-colors group"
        >
          <div>
            <p className="text-sm font-medium text-gray-200">Platforms</p>
            <p className="text-[11px] text-gray-600 mt-0.5">
              mechmarket, Poshmark, Mercari, eBay, Etsy, Imgur and more
            </p>
          </div>
          <span className="text-gray-700 group-hover:text-gray-500 transition-colors">→</span>
        </a>
      </div>
    </div>
  )
}
