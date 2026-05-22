'use client'

import { type ReactNode, useState } from 'react'

// ── types ────────────────────────────────────────────────────────────────────

interface TextFieldDef {
  kind: 'text' | 'textarea' | 'password'
  key: string
  label: string
  placeholder?: string
}

interface OAuthButtonDef {
  kind: 'oauth'
  platform: string
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
  devPortalUrl?: string
}

// ── platform definitions ─────────────────────────────────────────────────────

const PLATFORMS: PlatformDef[] = [
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
    description: 'Paste your Mercari Bearer token to enable listing. In Chrome: open mercari.com → DevTools → Network tab → click any page action → find a request to api.mercari.com → copy the Authorization header value (everything after "Bearer ").',
    fields: [
      { kind: 'password', key: 'mercari_api_token', label: 'Bearer token', placeholder: 'Paste token here…' },
    ],
    supportsRules: true,
  },
  {
    id: 'reddit',
    name: 'Reddit / r/mechmarket',
    description:
      'Paste your Reddit session token to enable r/mechmarket posting — no app required. ' +
      'Open reddit.com in Chrome → F12 (DevTools) → Application tab → Cookies → reddit.com → ' +
      'find "token_v2" → copy its full value and paste below. ' +
      'With "Remember me" checked this token lasts ~2 years.',
    fields: [
      {
        kind: 'password' as const,
        key: 'reddit_token_v2',
        label: 'Reddit session token (token_v2)',
        placeholder: 'eyJhbGciOiJSUzI1NiIsImtpZCI6...',
      },
      { kind: 'text' as const, key: 'us_state', label: 'US state code', placeholder: 'NY' },
    ],
  },
  {
    id: 'etsy',
    name: 'Etsy',
    description: 'Connect your Etsy shop to publish listings automatically.',
    fields: [
      { kind: 'text', key: 'etsy_client_id', label: 'API key (keystring)', placeholder: 'from etsy.com/developers' },
      { kind: 'text', key: 'etsy_shop_id', label: 'Shop ID', placeholder: 'Numeric shop ID' },
      { kind: 'oauth', platform: 'etsy', key: 'etsy_access_token', label: 'Etsy' },
    ],
    supportsRules: true,
    devPortalUrl: 'https://www.etsy.com/developers',
  },
  {
    id: 'ebay',
    name: 'eBay',
    description:
      'Connect your eBay seller account via OAuth. Setup: ' +
      '(1) Go to developer.ebay.com → Application Keys → your app → OAuth Settings. ' +
      '(2) Under "eBay Redirect URL (RuName)", add a new entry and set the accepted URL to the Redirect URI shown below → save. ' +
      '(3) Copy the RuName value (looks like YourName-YourApp-PRD-XXXXXXXX). ' +
      '(4) Enter App ID, Cert ID, and RuName below → click Connect eBay.',
    fields: [
      { kind: 'text', key: 'ebay_client_id', label: 'App ID (client ID)', placeholder: 'from developer.ebay.com' },
      { kind: 'password', key: 'ebay_client_secret', label: 'Cert ID (client secret)' },
      { kind: 'text', key: 'ebay_ru_name', label: 'RuName (from eBay OAuth Settings)', placeholder: 'YourName-YourApp-PRD-XXXXXXXX' },
      { kind: 'oauth', platform: 'ebay', key: 'ebay_refresh_token', label: 'eBay' },
    ],
    supportsRules: true,
    devPortalUrl: 'https://developer.ebay.com/my/keys',
  },
]

// ── sub-components ───────────────────────────────────────────────────────────

function OAuthButton({ platform, label, connected }: Readonly<{ platform: string; label: string; connected: boolean }>) {
  return (
    <div className="flex items-center gap-3">
      <a
        href={`/api/auth/connect/${platform}`}
        className="px-3 py-2 text-xs rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors inline-block"
      >
        {connected ? `Re-connect ${label}` : `Connect ${label}`}
      </a>
      {connected && (
        <span className="text-[10px] text-emerald-500">Connected ✓</span>
      )}
    </div>
  )
}

function TextSettingRow({
  fieldDef,
  initialValue,
}: Readonly<{
  fieldDef: TextFieldDef
  initialValue: string
}>) {
  const [value, setValue] = useState(initialValue)
  const [savedValue, setSavedValue] = useState(initialValue)
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  async function save() {
    if (!value.trim() || value.trim() === savedValue) return
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
      setSavedValue(value.trim())
      setStatus('saved')
      setTimeout(() => setStatus('idle'), 2000)
    } finally {
      setPending(false)
    }
  }

  const sharedClass =
    'bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-700 outline-none focus:border-gray-600 transition-colors'

  const fieldId = `field-${fieldDef.key}`
  let saveLabel: ReactNode = 'Save'
  if (pending) saveLabel = 'Saving…'
  else if (status === 'error') saveLabel = <span className="text-red-400">Failed</span>
  else if (status === 'saved') saveLabel = 'Saved'

  return (
    <div className="space-y-1.5">
      <label htmlFor={fieldId} className="block text-[10px] text-gray-500">{fieldDef.label}</label>
      {fieldDef.kind === 'textarea' ? (
        <textarea
          id={fieldId}
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
            id={fieldId}
            type={fieldDef.kind === 'password' ? 'password' : 'text'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => void save()}
            placeholder={fieldDef.placeholder}
            className={`${sharedClass} flex-1 font-mono`}
          />
          <button
            onClick={() => void save()}
            disabled={!value.trim() || value.trim() === savedValue || pending}
            className="flex-none px-3 py-2 text-xs rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saveLabel}
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
}: Readonly<{
  platform: string
  initialValue: string
}>) {
  const [value, setValue] = useState(initialValue)
  const [savedValue, setSavedValue] = useState(initialValue)
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState<'idle' | 'cached' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [previewLength, setPreviewLength] = useState<number | null>(null)

  async function save() {
    const trimmed = value.trim()
    if (!trimmed || trimmed === savedValue) return
    setPending(true)
    setStatus('idle')
    try {
      const res = await fetch('/api/settings/platform-rules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, rulesUrl: trimmed }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string }
        setErrorMsg(errData.error ?? 'Failed to fetch rules page')
        setStatus('error')
        setTimeout(() => setStatus('idle'), 5000)
        return
      }
      const data = await res.json() as { ok: boolean; previewLength?: number }
      setSavedValue(trimmed)
      setPreviewLength(data.previewLength ?? null)
      setStatus('cached')
      setTimeout(() => setStatus('idle'), 4000)
    } finally {
      setPending(false)
    }
  }

  const sharedClass =
    'bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-700 outline-none focus:border-gray-600 transition-colors'

  const rulesFieldId = `rules-url-${platform}`
  let fetchLabel: ReactNode = 'Fetch'
  if (pending) fetchLabel = 'Fetching…'
  else if (status === 'error') fetchLabel = <span className="text-red-400">Failed</span>
  else if (status === 'cached') fetchLabel = 'Cached'

  return (
    <div className="space-y-1.5">
      <label htmlFor={rulesFieldId} className="block text-[10px] text-gray-500">Listing rules URL</label>
      <div className="flex gap-2">
        <input
          id={rulesFieldId}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void save()}
          placeholder="https://…/seller-policy"
          className={`${sharedClass} flex-1 font-mono`}
        />
        <button
          onClick={() => void save()}
          disabled={!value.trim() || value.trim() === savedValue || pending}
          className="flex-none px-3 py-2 text-xs rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {fetchLabel}
        </button>
      </div>
      {status === 'cached' && previewLength !== null && (
        <p className="text-[10px] text-emerald-500">Rules cached ({previewLength} chars)</p>
      )}
      {status === 'error' && (
        <p className="text-[10px] text-red-400">{errorMsg ?? 'Failed to fetch rules page'}</p>
      )}
    </div>
  )
}

function PlatformSection({
  platform,
  existingSettings,
  existingRules,
  siteUrl,
}: Readonly<{
  platform: PlatformDef
  existingSettings: Record<string, string>
  existingRules?: Record<string, string>
  siteUrl: string
}>) {
  const hasOAuth = platform.fields.some((f) => f.kind === 'oauth')
  const callbackUrl = hasOAuth ? `${siteUrl}/api/auth/callback/${platform.id}` : null

  return (
    <div className="rounded-xl border border-gray-800 p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-200">{platform.name}</h2>
          <p className="text-[11px] text-gray-600 mt-0.5">{platform.description}</p>
        </div>
        {platform.devPortalUrl && (
          <a
            href={platform.devPortalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-none text-[10px] text-blue-500 hover:text-blue-400 transition-colors whitespace-nowrap"
          >
            Create app →
          </a>
        )}
      </div>
      {callbackUrl && (
        <div className="space-y-1">
          <p className="text-[10px] text-gray-500">Redirect URI (paste into your app settings)</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-[10px] text-gray-400 font-mono truncate">
              {callbackUrl}
            </code>
            <button
              onClick={() => void navigator.clipboard.writeText(callbackUrl)}
              className="flex-none px-2 py-1.5 text-[10px] rounded bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors"
            >
              Copy
            </button>
          </div>
        </div>
      )}
      <div className="space-y-3">
        {platform.fields.map((field) =>
          field.kind === 'oauth' ? (
            <OAuthButton
              key={field.key}
              platform={field.platform}
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
  siteUrl: string
}

export function PlatformSettings({ existingSettings, existingRules, siteUrl }: Readonly<PlatformSettingsProps>) {
  return (
    <div className="space-y-4">
      {PLATFORMS.map((platform) => (
        <PlatformSection
          key={platform.id}
          platform={platform}
          existingSettings={existingSettings}
          existingRules={existingRules}
          siteUrl={siteUrl}
        />
      ))}
    </div>
  )
}
