import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ApiKeyRow } from './ApiKeyRow'
import { PROVIDERS } from '@/lib/providers'

export default async function ApiKeysPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: keyRows } = await supabase
    .from('user_api_keys')
    .select('provider, api_key')
    .eq('user_id', user.id)

  const keysMap = Object.fromEntries(
    (keyRows ?? []).map((r) => [r.provider, r.api_key ?? ''])
  )

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="flex items-center gap-3 px-6 py-3 border-b border-gray-800">
        <a href="/dashboard" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
          ← Dashboard
        </a>
        <span className="text-gray-800">/</span>
        <span className="text-xs text-gray-500">API Keys</span>
      </header>

      <div className="max-w-lg mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-100">API Keys</h1>
          <p className="text-xs text-gray-600 mt-1">
            Stored per-account. Used by the pipeline and agent chat.
            Keys are never returned to the browser after saving.
          </p>
        </div>

        <div className="rounded-xl border border-gray-800 divide-y divide-gray-800">
          {PROVIDERS.map((p) => (
            <ApiKeyRow
              key={p.id}
              provider={p.id}
              label={p.label}
              placeholder={p.placeholder}
              maskedValue={keysMap[p.id] ? `••••••••${keysMap[p.id].slice(-4)}` : null}
            />
          ))}
        </div>

        <p className="text-[10px] text-gray-700">
          Paste a new key into the field and click Save to update. The masked hint
          shows the last 4 characters of the currently stored key.
        </p>
      </div>
    </div>
  )
}
