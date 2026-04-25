'use client'

import { useState, useEffect } from 'react'
import { Copy, Check, ExternalLink } from 'lucide-react'
import { CopyField } from './CopyField'
import type { Listing, ListingStatus } from '@/types/listings'

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
  const [urlInputs, setUrlInputs] = useState({ ebay: '', poshmark: '' })
  const [savedUrls, setSavedUrls] = useState<{ ebay?: string; poshmark?: string }>({
    ebay: listing.listing_urls?.ebay,
    poshmark: listing.listing_urls?.poshmark,
  })
  const [listingStatus, setListingStatus] = useState<ListingStatus>(listing.status)
  const [saving, setSaving] = useState<Platform | null>(null)
  const [markingPublished, setMarkingPublished] = useState(false)
  const [copyAllDone, setCopyAllDone] = useState(false)

  useEffect(() => { setCopyAllDone(false) }, [activeTab])

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
        setListingStatus(data.status as ListingStatus)
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
