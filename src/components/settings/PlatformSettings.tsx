'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

// ── types ────────────────────────────────────────────────────────────────────

interface TextFieldDef {
  kind: 'text' | 'textarea' | 'password'
  key: string
  label: string
  placeholder?: string
}

interface OAuthButtonDef {
  kind: 'oauth'
  key: string
  label: string
}

type FieldDef = TextFieldDef | OAuthButtonDef

interface PlatformDef {
  id: string
  name: string
  description: string
  fields: FieldDef[]
  supportsRules?: boolean
}

// ── platform definitions ─────────────────────────────────────────────────────

const PLATFORMS: PlatformDef[] = [
  {
    id: 'mechmarket',
    name: 'mechmarket',
    description: 'Reddit r/mechmarket listings require your Reddit username and US state code.',
    fields: [
      { kind: 'text', key: 'reddit_username', label: 'Reddit username', placeholder: 'u/yourname' },
      { kind: 'text', key: 'us_state', label: 'US state code', placeholder: 'NY' },
    ],
  },
  {
    id: 'poshmark',
    name: 'Poshmark',
    description: 'Paste your Poshmark session cookie string to enable automated listing.',
    fields: [
      { kind: 'password', key: 'poshmark_cookies', label: 'Cookie string', placeholder: 'Paste cookie string here…' },
    ],
    supportsRules: true,
  },
  {
    id: 'mercari',
    name: 'Mercari',
    description: 'Enter your Mercari API token.',
    fields: [
      { kind: 'password', key: 'mercari_api_token', label: 'API token', placeholder: 'Paste token…' },
    ],
    supportsRules: true,
  },
  {
    id: 'therealreal',
    name: 'TheRealReal',
    description: 'Enter your Apify API token for TheRealReal scraping.',
    fields: [
      { kind: 'password', key: 'apify_api_token', label: 'Apify API token', placeholder: 'Paste token…' },
    ],
  },
  {
    id: 'imgur',
    name: 'Imgur',
    description: 'Connect your Imgur account to host listing images.',
    fields: [
      { kind: 'oauth', key: 'imgur_access_token', label: 'Imgur' },
    ],
  },
  {
    id: 'reddit',
    name: 'Reddit',
    description: 'Connect your Reddit account for posting and replying.',
    fields: [
      { kind: 'oauth', key: 'reddit_refresh_token', label: 'Reddit' },
    ],
  },
  {
    id: 'etsy',
    name: 'Etsy',
    description: 'Connect your Etsy shop to publish listings automatically.',
    fields: [
      { kind: 'oauth', key: 'etsy_access_token', label: 'Etsy' },
    ],
    supportsRules: true,
  },
  {
    id: 'ebay',
    name: 'eBay',
    description: 'Connect your eBay seller account to cross-list items.',
    fields: [
      { kind: 'oauth', key: 'ebay_refresh_token', label: 'eBay' },
    ],
    supportsRules: true,
  },
]

// ── sub-components ───────────────────────────────────────────────────────────

function OAuthButton({ fieldKey, label, connected }: { fieldKey: string; label: string; connected: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <button
        disabled
        title="OAuth flow coming soon"
        className="px-3 py-2 text-xs rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {connected ? `${label}: Connected` : `Connect ${label}`}
      </button>
      {connected && (
        <span className="text-[10px] text-emerald-500">Token stored</span>
      )}
      <span className="text-[10px] text-gray-600 italic">(OAuth flow coming soon)</span>
    </div>
  )
}

function TextSettingRow({
  fieldDef,
  initialValue,
}: {
  fieldDef: TextFieldDef
  initialValue: string
}) {
  const router = useRouter()
  const [value, setValue] = useState(initialValue)
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  async function save() {
    if (!value.trim() || value.trim() === initialValue) return
    setPending(true)
    setStatus('idle')
    try {
      const res = await fetch('/api/settings/platform', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: fieldDef.key, value: value.trim() }),
      })
      if (!res.ok) {
        setStatus('error')
        setTimeout(() => setStatus('idle'), 2000)
        return
      }
      setStatus('saved')
      router.refresh()
      setTimeout(() => setStatus('idle'), 2000)
    } finally {
      setPending(false)
    }
  }

  const sharedClass =
    'bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-700 outline-none focus:border-gray-600 transition-colors'

  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] text-gray-500">{fieldDef.label}</label>
      {fieldDef.kind === 'textarea' ? (
        <textarea
          rows={3}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void save()}
          placeholder={fieldDef.placeholder}
          className={`${sharedClass} w-full resize-none font-mono`}
        />
      ) : (
        <div className="flex gap-2">
          <input
            type={fieldDef.kind === 'password' ? 'password' : 'text'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => void save()}
            placeholder={fieldDef.placeholder}
            className={`${sharedClass} flex-1 font-mono`}
          />
          <button
            onClick={() => void save()}
            disabled={!value.trim() || value.trim() === initialValue || pending}
            className="flex-none px-3 py-2 text-xs rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? 'Saving…' : status === 'error' ? <span className="text-red-400">Failed</span> : status === 'saved' ? 'Saved' : 'Save'}
          </button>
        </div>
      )}
      {status === 'saved' && fieldDef.kind === 'textarea' && (
        <p className="text-[10px] text-emerald-500">Saved</p>
      )}
      {status === 'error' && (
        <p className="text-[10px] text-red-400">Failed to save</p>
      )}
    </div>
  )
}

function RulesUrlRow({
  platform,
  initialValue,
}: {
  platform: string
  initialValue: string
}) {
  const [value, setValue] = useState(initialValue)
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState<'idle' | 'cached' | 'error'>('idle')
  const [previewLength, setPreviewLength] = useState<number | null>(null)

  async function save() {
    const trimmed = value.trim()
    if (!trimmed || trimmed === initialValue) return
    setPending(true)
    setStatus('idle')
    try {
      const res = await fetch('/api/settings/platform-rules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, rulesUrl: trimmed }),
      })
      if (!res.ok) {
        setStatus('error')
        setTimeout(() => setStatus('idle'), 3000)
        return
      }
      const data = await res.json() as { ok: boolean; previewLength?: number }
      setPreviewLength(data.previewLength ?? null)
      setStatus('cached')
      setTimeout(() => setStatus('idle'), 4000)
    } finally {
      setPending(false)
    }
  }

  const sharedClass =
    'bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-700 outline-none focus:border-gray-600 transition-colors'

  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] text-gray-500">Listing rules URL</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void save()}
          placeholder="https://…/seller-policy"
          className={`${sharedClass} flex-1 font-mono`}
        />
        <button
          onClick={() => void save()}
          disabled={!value.trim() || value.trim() === initialValue || pending}
          className="flex-none px-3 py-2 text-xs rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {pending ? 'Fetching…' : status === 'error' ? <span className="text-red-400">Failed</span> : status === 'cached' ? 'Cached' : 'Fetch'}
        </button>
      </div>
      {status === 'cached' && previewLength !== null && (
        <p className="text-[10px] text-emerald-500">Rules cached ({previewLength} chars)</p>
      )}
      {status === 'error' && (
        <p className="text-[10px] text-red-400">Failed to fetch rules page</p>
      )}
    </div>
  )
}

function PlatformSection({
  platform,
  existingSettings,
  existingRules,
}: {
  platform: PlatformDef
  existingSettings: Record<string, string>
  existingRules?: Record<string, string>
}) {
  return (
    <div className="rounded-xl border border-gray-800 p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-200">{platform.name}</h2>
        <p className="text-[11px] text-gray-600 mt-0.5">{platform.description}</p>
      </div>
      <div className="space-y-3">
        {platform.fields.map((field) =>
          field.kind === 'oauth' ? (
            <OAuthButton
              key={field.key}
              fieldKey={field.key}
              label={field.label}
              connected={Boolean(existingSettings[field.key])}
            />
          ) : (
            <TextSettingRow
              key={field.key}
              fieldDef={field}
              initialValue={existingSettings[field.key] ?? ''}
            />
          )
        )}
        {platform.supportsRules && (
          <RulesUrlRow
            platform={platform.id}
            initialValue={existingRules?.[platform.id] ?? ''}
          />
        )}
      </div>
    </div>
  )
}

// ── main export ──────────────────────────────────────────────────────────────

export interface PlatformSettingsProps {
  existingSettings: Record<string, string>
  existingRules?: Record<string, string>
}

export function PlatformSettings({ existingSettings, existingRules }: PlatformSettingsProps) {
  return (
    <div className="space-y-4">
      {PLATFORMS.map((platform) => (
        <PlatformSection
          key={platform.id}
          platform={platform}
          existingSettings={existingSettings}
          existingRules={existingRules}
        />
      ))}
    </div>
  )
}
