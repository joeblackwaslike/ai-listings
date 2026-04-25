# Publish Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export page at `/listings/[id]/publish` — eBay/Poshmark tabs with per-field copy buttons, copy-all, URL paste + save, and status transition to `published`.

**Architecture:** PATCH API route updates `listing_urls` JSONB and/or `status`. Client `PlatformTabs` component manages tab state, URL input, and calls the API. SEO audit is a pure derived component (no API calls). All new files; one small header link added to the existing workspace page.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, Clipboard API, `@supabase/supabase-js` service role in the API route.

---

## File Map

| File | Create / Modify |
|------|-----------------|
| `src/app/api/listings/[id]/publish/route.ts` | Create |
| `src/components/publish/CopyField.tsx` | Create |
| `src/components/publish/SeoAudit.tsx` | Create |
| `src/components/publish/PlatformTabs.tsx` | Create |
| `src/app/listings/[id]/publish/page.tsx` | Create |
| `src/app/listings/[id]/page.tsx` | Modify (header only) |

---

## Task 1: PATCH API route

**Files:**
- Create: `src/app/api/listings/[id]/publish/route.ts`

- [ ] **Step 1.1: Create the directory and file**

```bash
mkdir -p "src/app/api/listings/[id]/publish"
```

Create `src/app/api/listings/[id]/publish/route.ts`:

```typescript
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let body: { platform?: string; listing_url?: string; mark_published?: boolean }
  try {
    body = await req.json() as typeof body
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { platform, listing_url, mark_published } = body

  if (!listing_url && !mark_published) {
    return Response.json({ error: 'No action specified' }, { status: 400 })
  }

  if (listing_url && !platform) {
    return Response.json({ error: 'platform required when listing_url is provided' }, { status: 400 })
  }

  if (platform && platform !== 'ebay' && platform !== 'poshmark') {
    return Response.json({ error: 'platform must be ebay or poshmark' }, { status: 400 })
  }

  if (listing_url) {
    try {
      new URL(listing_url)
    } catch {
      return Response.json({ error: 'listing_url must be a valid URL' }, { status: 400 })
    }
  }

  const supabase = getAdmin()

  const { data: current, error: fetchError } = await supabase
    .from('listings')
    .select('listing_urls, status')
    .eq('id', id)
    .single()

  if (fetchError || !current) {
    return Response.json({ error: 'Listing not found' }, { status: 404 })
  }

  const updates: Record<string, unknown> = {}

  if (listing_url && platform) {
    const existing = (current.listing_urls as Record<string, string> | null) ?? {}
    updates.listing_urls = { ...existing, [platform]: listing_url }
  }

  if (mark_published) {
    updates.status = 'published'
  }

  const { data: updated, error: updateError } = await supabase
    .from('listings')
    .update(updates)
    .eq('id', id)
    .select('status, listing_urls')
    .single()

  if (updateError) {
    return Response.json({ error: updateError.message }, { status: 500 })
  }

  return Response.json({ ok: true, status: updated.status, listing_urls: updated.listing_urls })
}
```

- [ ] **Step 1.2: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 1.3: Commit**

```bash
git add "src/app/api/listings/[id]/publish/route.ts"
git commit -m "feat: add PATCH /api/listings/[id]/publish — save listing URL, mark published"
```

---

## Task 2: CopyField + SeoAudit

**Files:**
- Create: `src/components/publish/CopyField.tsx`
- Create: `src/components/publish/SeoAudit.tsx`

- [ ] **Step 2.1: Create `src/components/publish/CopyField.tsx`**

```typescript
'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface CopyFieldProps {
  label: string
  value: string
  multiline?: boolean
}

export function CopyField({ label, value, multiline = false }: CopyFieldProps) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-800/60 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider mb-1">{label}</p>
        {multiline ? (
          <p className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed line-clamp-4">{value}</p>
        ) : (
          <p className="text-xs text-gray-300 truncate">{value}</p>
        )}
      </div>
      <button
        onClick={() => void copy()}
        className="flex-none mt-0.5 p-1.5 rounded-lg text-gray-600 hover:text-gray-300 hover:bg-gray-800 transition-colors"
        title="Copy to clipboard"
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-emerald-500" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  )
}
```

- [ ] **Step 2.2: Create `src/components/publish/SeoAudit.tsx`**

```typescript
import { CheckCircle2, XCircle } from 'lucide-react'
import type { Listing } from '@/types/listings'

interface SeoAuditProps {
  listing: Listing
}

interface AuditCheck {
  label: string
  pass: boolean
  detail?: string
}

function deriveChecks(listing: Listing): AuditCheck[] {
  const ebay = listing.platform_fields?.ebay
  const poshmark = listing.platform_fields?.poshmark
  const checks: AuditCheck[] = []

  const ebayTitle = ebay?.title ?? ''
  checks.push({
    label: 'eBay title set',
    pass: ebayTitle.length > 0,
  })
  checks.push({
    label: `eBay title ≤ 80 chars`,
    pass: ebayTitle.length > 0 && ebayTitle.length <= 80,
    detail: ebayTitle.length > 0 ? `${ebayTitle.length}/80` : undefined,
  })
  checks.push({
    label: 'eBay title ≥ 3 keywords',
    pass: ebayTitle.trim().split(/\s+/).filter(Boolean).length >= 3,
  })

  const ebayDesc = ebay?.description ?? ''
  checks.push({
    label: 'eBay description ≥ 50 chars',
    pass: ebayDesc.length >= 50,
    detail: ebayDesc.length > 0 ? `${ebayDesc.length} chars` : undefined,
  })

  const specificsCount = Object.keys(ebay?.item_specifics ?? {}).length
  checks.push({
    label: 'eBay item specifics ≥ 3',
    pass: specificsCount >= 3,
    detail: `${specificsCount} set`,
  })

  const poshTitle = poshmark?.title ?? ''
  checks.push({
    label: 'Poshmark title set',
    pass: poshTitle.length > 0,
  })
  checks.push({
    label: 'Poshmark title ≤ 60 chars',
    pass: poshTitle.length > 0 && poshTitle.length <= 60,
    detail: poshTitle.length > 0 ? `${poshTitle.length}/60` : undefined,
  })

  const poshDesc = poshmark?.description ?? ''
  checks.push({
    label: 'Poshmark description ≥ 50 chars',
    pass: poshDesc.length >= 50,
    detail: poshDesc.length > 0 ? `${poshDesc.length} chars` : undefined,
  })

  checks.push({
    label: 'Suggested price set',
    pass: listing.suggested_price_cents != null,
  })

  return checks
}

export function SeoAudit({ listing }: SeoAuditProps) {
  const checks = deriveChecks(listing)
  const passCount = checks.filter((c) => c.pass).length

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-300">SEO Audit</h3>
        <span className={`text-[10px] font-medium ${passCount === checks.length ? 'text-emerald-400' : 'text-gray-500'}`}>
          {passCount}/{checks.length} passing
        </span>
      </div>
      <ul className="space-y-1.5">
        {checks.map((check, i) => (
          <li key={i} className="flex items-center gap-2">
            {check.pass ? (
              <CheckCircle2 className="w-3.5 h-3.5 flex-none text-emerald-500" />
            ) : (
              <XCircle className="w-3.5 h-3.5 flex-none text-gray-700" />
            )}
            <span className={`text-xs ${check.pass ? 'text-gray-400' : 'text-gray-600'}`}>
              {check.label}
            </span>
            {check.detail && (
              <span className="text-[10px] text-gray-700 ml-auto">{check.detail}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 2.3: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 2.4: Commit**

```bash
git add src/components/publish/CopyField.tsx src/components/publish/SeoAudit.tsx
git commit -m "feat: add CopyField and SeoAudit publish components"
```

---

## Task 3: PlatformTabs

**Files:**
- Create: `src/components/publish/PlatformTabs.tsx`

This is the main client component. Manages tab state, URL inputs, and API calls.

- [ ] **Step 3.1: Create `src/components/publish/PlatformTabs.tsx`**

```typescript
'use client'

import { useState } from 'react'
import { Copy, Check, ExternalLink } from 'lucide-react'
import { CopyField } from './CopyField'
import type { Listing } from '@/types/listings'

interface PlatformTabsProps {
  listing: Listing
}

type Platform = 'ebay' | 'poshmark'

function buildEbayCopyAll(listing: Listing): string {
  const ebay = listing.platform_fields?.ebay
  if (!ebay) return ''
  const specifics = Object.entries(ebay.item_specifics ?? {})
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n')
  return [
    `Title: ${ebay.title}`,
    `Category ID: ${ebay.category_id}`,
    `Condition: ${ebay.condition_id}`,
    ``,
    `Description:`,
    ebay.description,
    specifics ? `\nItem Specifics:\n${specifics}` : '',
  ]
    .filter((l) => l !== undefined)
    .join('\n')
    .trim()
}

function buildPoshmarkCopyAll(listing: Listing): string {
  const p = listing.platform_fields?.poshmark
  if (!p) return ''
  return [
    `Title: ${p.title}`,
    `Category: ${p.category}`,
    `Size: ${p.size}`,
    p.original_price != null ? `Original Price: $${p.original_price}` : '',
    ``,
    `Description:`,
    p.description,
  ]
    .filter((l) => l !== undefined && l !== null)
    .join('\n')
    .trim()
}

export function PlatformTabs({ listing }: PlatformTabsProps) {
  const [activeTab, setActiveTab] = useState<Platform>('ebay')
  const [urlInputs, setUrlInputs] = useState({
    ebay: '',
    poshmark: '',
  })
  const [savedUrls, setSavedUrls] = useState<{ ebay?: string; poshmark?: string }>({
    ebay: listing.listing_urls?.ebay,
    poshmark: listing.listing_urls?.poshmark,
  })
  const [listingStatus, setListingStatus] = useState(listing.status)
  const [saving, setSaving] = useState<Platform | null>(null)
  const [markingPublished, setMarkingPublished] = useState(false)
  const [copyAllDone, setCopyAllDone] = useState(false)

  const hasAnyUrl = savedUrls.ebay || savedUrls.poshmark

  async function saveUrl(platform: Platform) {
    const url = urlInputs[platform].trim()
    if (!url) return
    setSaving(platform)
    try {
      const res = await fetch(`/api/listings/${listing.id}/publish`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, listing_url: url }),
      })
      const data = await res.json() as { ok?: boolean; listing_urls?: Record<string, string> }
      if (data.ok && data.listing_urls) {
        setSavedUrls({ ebay: data.listing_urls.ebay, poshmark: data.listing_urls.poshmark })
        setUrlInputs((prev) => ({ ...prev, [platform]: '' }))
      }
    } finally {
      setSaving(null)
    }
  }

  async function markPublished() {
    setMarkingPublished(true)
    try {
      const res = await fetch(`/api/listings/${listing.id}/publish`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mark_published: true }),
      })
      const data = await res.json() as { ok?: boolean; status?: string }
      if (data.ok && data.status) {
        setListingStatus(data.status as typeof listingStatus)
      }
    } finally {
      setMarkingPublished(false)
    }
  }

  async function copyAll() {
    const text = activeTab === 'ebay'
      ? buildEbayCopyAll(listing)
      : buildPoshmarkCopyAll(listing)
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopyAllDone(true)
    setTimeout(() => setCopyAllDone(false), 1500)
  }

  const ebay = listing.platform_fields?.ebay
  const poshmark = listing.platform_fields?.poshmark

  return (
    <div className="space-y-6">
      {/* Status + mark published */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">Status:</span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            listingStatus === 'published'
              ? 'bg-purple-900/60 text-purple-300'
              : 'bg-emerald-900/60 text-emerald-400'
          }`}>
            {listingStatus === 'published' ? 'Published' : 'Ready'}
          </span>
        </div>
        {hasAnyUrl && listingStatus !== 'published' && (
          <button
            onClick={() => void markPublished()}
            disabled={markingPublished}
            className="text-xs px-3 py-1.5 rounded-lg bg-purple-900/60 text-purple-300 hover:bg-purple-900 disabled:opacity-50 transition-colors"
          >
            {markingPublished ? 'Saving…' : 'Mark as Published'}
          </button>
        )}
        {listingStatus === 'published' && (
          <span className="text-xs text-purple-400">✓ Published</span>
        )}
      </div>

      {/* Tabs */}
      <div className="space-y-4">
        <div className="flex gap-1 border-b border-gray-800">
          {(['ebay', 'poshmark'] as Platform[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-xs font-medium capitalize transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {tab === 'ebay' ? 'eBay' : 'Poshmark'}
            </button>
          ))}
        </div>

        {/* eBay tab */}
        {activeTab === 'ebay' && (
          <div className="space-y-4">
            {!ebay ? (
              <p className="text-sm text-gray-600">No eBay fields generated yet — pipeline step 4 must complete first.</p>
            ) : (
              <>
                <div className="rounded-xl border border-gray-800 bg-gray-900/30 divide-y divide-gray-800/60">
                  <CopyField label="Title" value={ebay.title} />
                  <CopyField label="Category ID" value={ebay.category_id} />
                  <CopyField label="Condition" value={ebay.condition_id} />
                  <CopyField label="Description" value={ebay.description} multiline />
                  {Object.entries(ebay.item_specifics ?? {}).map(([key, val]) => (
                    <CopyField key={key} label={key} value={val} />
                  ))}
                </div>
                <button
                  onClick={() => void copyAll()}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  {copyAllDone ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  {copyAllDone ? 'Copied!' : 'Copy all eBay fields'}
                </button>
              </>
            )}

            {/* URL input */}
            <div className="space-y-2 pt-2">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">eBay Listing URL</p>
              {savedUrls.ebay && (
                <a
                  href={savedUrls.ebay}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 truncate"
                >
                  <ExternalLink className="w-3 h-3 flex-none" />
                  {savedUrls.ebay}
                </a>
              )}
              <div className="flex gap-2">
                <input
                  type="url"
                  value={urlInputs.ebay}
                  onChange={(e) => setUrlInputs((prev) => ({ ...prev, ebay: e.target.value }))}
                  placeholder="https://www.ebay.com/itm/..."
                  className="flex-1 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-700 outline-none focus:border-gray-600 transition-colors"
                />
                <button
                  onClick={() => void saveUrl('ebay')}
                  disabled={!urlInputs.ebay.trim() || saving === 'ebay'}
                  className="px-3 py-2 text-xs rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {saving === 'ebay' ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Poshmark tab */}
        {activeTab === 'poshmark' && (
          <div className="space-y-4">
            {!poshmark ? (
              <p className="text-sm text-gray-600">No Poshmark fields generated yet — pipeline step 4 must complete first.</p>
            ) : (
              <>
                <div className="rounded-xl border border-gray-800 bg-gray-900/30 divide-y divide-gray-800/60">
                  <CopyField label="Title" value={poshmark.title} />
                  <CopyField label="Category" value={poshmark.category} />
                  <CopyField label="Size" value={poshmark.size} />
                  {poshmark.original_price != null && (
                    <CopyField label="Original Price" value={`$${poshmark.original_price}`} />
                  )}
                  <CopyField label="Description" value={poshmark.description} multiline />
                </div>
                <button
                  onClick={() => void copyAll()}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  {copyAllDone ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  {copyAllDone ? 'Copied!' : 'Copy all Poshmark fields'}
                </button>
              </>
            )}

            {/* URL input */}
            <div className="space-y-2 pt-2">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Poshmark Listing URL</p>
              {savedUrls.poshmark && (
                <a
                  href={savedUrls.poshmark}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 truncate"
                >
                  <ExternalLink className="w-3 h-3 flex-none" />
                  {savedUrls.poshmark}
                </a>
              )}
              <div className="flex gap-2">
                <input
                  type="url"
                  value={urlInputs.poshmark}
                  onChange={(e) => setUrlInputs((prev) => ({ ...prev, poshmark: e.target.value }))}
                  placeholder="https://poshmark.com/listing/..."
                  className="flex-1 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-700 outline-none focus:border-gray-600 transition-colors"
                />
                <button
                  onClick={() => void saveUrl('poshmark')}
                  disabled={!urlInputs.poshmark.trim() || saving === 'poshmark'}
                  className="px-3 py-2 text-xs rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {saving === 'poshmark' ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3.2: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3.3: Commit**

```bash
git add src/components/publish/PlatformTabs.tsx
git commit -m "feat: add PlatformTabs — eBay/Poshmark copy fields, URL save, mark published"
```

---

## Task 4: Publish page + workspace header link

**Files:**
- Create: `src/app/listings/[id]/publish/page.tsx`
- Modify: `src/app/listings/[id]/page.tsx` (header only)

- [ ] **Step 4.1: Create the publish page directory**

```bash
mkdir -p "src/app/listings/[id]/publish"
```

- [ ] **Step 4.2: Create `src/app/listings/[id]/publish/page.tsx`**

```typescript
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SeoAudit } from '@/components/publish/SeoAudit'
import { PlatformTabs } from '@/components/publish/PlatformTabs'
import type { Listing } from '@/types/listings'

export default async function PublishPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) {
    notFound()
  }

  const listing = data as unknown as Listing

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="flex items-center gap-3 px-6 py-3 border-b border-gray-800">
        <a href={`/listings/${id}`} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
          ← Workspace
        </a>
        <span className="text-gray-800">/</span>
        <span className="text-xs text-gray-500">Publish Export</span>
        <span className="ml-auto text-xs font-mono text-gray-700">{listing.sku ?? id.slice(0, 8)}</span>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h1 className="text-lg font-semibold text-gray-100">
            {listing.title ?? listing.brand ?? 'Untitled'}
          </h1>
          {listing.suggested_price_cents != null && (
            <p className="text-sm text-emerald-400 font-semibold mt-0.5">
              ${(listing.suggested_price_cents / 100).toFixed(0)} suggested
            </p>
          )}
        </div>

        <SeoAudit listing={listing} />
        <PlatformTabs listing={listing} />
      </div>
    </div>
  )
}
```

- [ ] **Step 4.3: Add "Export →" link to workspace header**

Read `src/app/listings/[id]/page.tsx`, then make a targeted edit. Find the header element:

```typescript
      <header className="flex-none flex items-center gap-3 px-6 py-3 border-b border-gray-800 bg-gray-950">
        <a href="/dashboard" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
          ← Dashboard
        </a>
        <span className="text-gray-800">/</span>
        <span className="text-xs text-gray-400 font-mono">{listing.sku ?? listing.id.slice(0, 8)}</span>
      </header>
```

Replace with:

```typescript
      <header className="flex-none flex items-center gap-3 px-6 py-3 border-b border-gray-800 bg-gray-950">
        <a href="/dashboard" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
          ← Dashboard
        </a>
        <span className="text-gray-800">/</span>
        <span className="text-xs text-gray-400 font-mono">{listing.sku ?? listing.id.slice(0, 8)}</span>
        <a href={`/listings/${id}/publish`} className="ml-auto text-xs text-gray-600 hover:text-gray-400 transition-colors">
          Export →
        </a>
      </header>
```

- [ ] **Step 4.4: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4.5: Commit**

```bash
git add "src/app/listings/[id]/publish/page.tsx" src/app/listings/[id]/page.tsx
git commit -m "feat: publish export page — SEO audit, platform tabs, workspace header link"
```

---

## Task 5: Close issue

- [ ] **Step 5.1: Final type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5.2: Close beads issue**

```bash
bd close ai-listings-nms --reason="Publish export implemented: PATCH API saves listing URLs + transitions status to published, CopyField + SeoAudit + PlatformTabs components, dedicated /publish page with SEO checklist, eBay/Poshmark tabs, per-field copy + copy-all, URL paste + save. Export link added to workspace header. All files type-check clean."
```

---

## Self-Review

**Spec coverage:**

| Requirement | Task |
|-------------|------|
| Platform tabs (eBay/Poshmark) | Task 3 — PlatformTabs |
| Per-field Copy buttons | Task 2 — CopyField |
| Copy All | Task 3 — buildEbayCopyAll/buildPoshmarkCopyAll |
| Listing URL input + save | Task 3 — saveUrl() |
| SEO audit checklist | Task 2 — SeoAudit |
| Status transition finalizing→published | Task 1 — PATCH API + Task 3 — markPublished() |
| Export link from workspace | Task 4 — header link |

**Done when:** Copy all eBay fields ✅ · Paste listing URL ✅ · Listing → published ✅

**Type consistency:** `listing.listing_urls` is `ListingUrls` which has `ebay?` and `poshmark?` as optional strings — matches `savedUrls` state shape. `listing.platform_fields.ebay.item_specifics` is `Record<string, string>` — `Object.entries()` returns `[string, string][]` ✅.
