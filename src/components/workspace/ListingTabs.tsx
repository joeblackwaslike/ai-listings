'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { InclusionsTab } from './InclusionsTab'
import { AuthenticationTab } from './AuthenticationTab'
import { PhotoShootTab } from './PhotoShootTab'
import type { Listing, AuthStep, Inclusion, PhotoShot, PhotoShotStatus } from '@/types/listings'

type TabKey = 'inclusions' | 'authentication' | 'photos'

const STEP_CYCLE: Record<AuthStep['status'], AuthStep['status']> = {
  pending: 'done',
  done: 'failed',
  failed: 'pending',
}

const sameItem = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

interface ListingTabsProps {
  listing: Listing
  photosConfirmed: boolean
}

/** Tabbed Inclusions / Authentication / Photo Shoot block. Owns the state and saves for all three. */
export function ListingTabs({ listing, photosConfirmed }: Readonly<ListingTabsProps>) {
  const router = useRouter()
  const idBase = useId()
  const [selected, setSelected] = useState<TabKey>('inclusions')
  const [inclusions, setInclusions] = useState<Inclusion[]>(listing.inclusions ?? [])
  const [authSteps, setAuthSteps] = useState<AuthStep[]>(listing.auth_plan ?? [])
  const [savingAuth, setSavingAuth] = useState(false)
  const [shots, setShots] = useState<PhotoShot[]>(listing.photo_plan ?? [])
  const [refreshingPlan, setRefreshingPlan] = useState(false)
  const savingInclusionsRef = useRef(false)
  const pendingShotSaves = useRef(0)
  const pendingAuthSaves = useRef(0)

  // AutoRefresh polls via router.refresh(), which re-renders with a new `listing` prop but does
  // not re-run useState's initializer -- without this, inclusions detected asynchronously from
  // studio photos (photo-quality-gate.ts) never appear until a full reload. Guarded so a refresh
  // landing mid-save doesn't clobber an optimistic update with a not-yet-persisted server value.
  useEffect(() => {
    if (savingInclusionsRef.current) return
    setInclusions(listing.inclusions ?? [])
  }, [listing.inclusions])

  // Same for shots: batch-quality-check marks shots verified in the background.
  useEffect(() => {
    if (pendingShotSaves.current > 0) return
    setShots(listing.photo_plan ?? [])
  }, [listing.photo_plan])

  // And for the auth plan, which the pipeline can generate after the page loaded.
  useEffect(() => {
    if (pendingAuthSaves.current > 0) return
    setAuthSteps(listing.auth_plan ?? [])
  }, [listing.auth_plan])

  const showAuth = listing.is_luxury && authSteps.length > 0
  const tab: TabKey = selected === 'authentication' && !showAuth ? 'inclusions' : selected

  async function saveInclusions(updated: Inclusion[]) {
    const previous = inclusions
    savingInclusionsRef.current = true
    setInclusions(updated)
    try {
      const res = await fetch(`/api/listings/${listing.id}/inclusions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inclusions: updated }),
      })
      // On a failed save, roll back rather than leaving inclusions displayed that were never
      // persisted. On success, refresh so PriceCard (photo column, reads the server listing)
      // reprices against the new gate without waiting for the poll.
      if (res.ok) router.refresh()
      else setInclusions(previous)
    } catch {
      setInclusions(previous)
    } finally {
      savingInclusionsRef.current = false
    }
  }

  function addInclusion(name: string) {
    const item = name.trim()
    if (!item || inclusions.some((i) => sameItem(i.item, item))) return
    void saveInclusions([...inclusions, { item, source: 'manual', confirmed: true, notes: null }])
  }

  async function saveAuthPlan(updated: AuthStep[]) {
    pendingAuthSaves.current += 1
    setSavingAuth(true)
    try {
      await fetch(`/api/listings/${listing.id}/auth-plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_plan: updated }),
      })
    } finally {
      pendingAuthSaves.current -= 1
      setSavingAuth(false)
    }
  }

  function toggleStep(i: number) {
    const updated = authSteps.map((s, idx) => (idx === i ? { ...s, status: STEP_CYCLE[s.status] } : s))
    setAuthSteps(updated)
    void saveAuthPlan(updated)
  }

  function skipAllAuth() {
    const updated = authSteps.map((s) => ({ ...s, status: 'done' as const }))
    setAuthSteps(updated)
    void saveAuthPlan(updated)
  }

  async function refreshPhotoPlan() {
    setRefreshingPlan(true)
    try {
      await fetch(`/api/listings/${listing.id}/photo-plan/refresh`, { method: 'POST' })
      router.refresh()
    } finally {
      setRefreshingPlan(false)
    }
  }

  const setShotStatus = (name: string, status: PhotoShotStatus) =>
    setShots((prev) => prev.map((s) => (s.shot === name ? { ...s, status } : s)))

  async function toggleShot(name: string) {
    const current = shots.find((s) => s.shot === name)
    if (!current || current.status === 'verified') return
    const previous: PhotoShotStatus = current.status ?? 'pending'
    const next: PhotoShotStatus = previous === 'taken' ? 'pending' : 'taken'
    setShotStatus(name, next)
    pendingShotSaves.current += 1
    try {
      const res = await fetch(`/api/listings/${listing.id}/photo-plan/shots`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shot: name, status: next }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(res.status === 409 ? 'That shot was already verified by the photo check' : body?.error ?? `Save failed (${res.status})`)
      }
    } catch (err) {
      setShotStatus(name, previous)
      toast.error(err instanceof Error ? err.message : "Couldn't save the shot")
      router.refresh()
    } finally {
      pendingShotSaves.current -= 1
    }
  }

  const doneAuth = authSteps.filter((s) => s.status === 'done').length
  const doneShots = shots.filter((s) => s.status === 'taken' || s.status === 'verified').length
  const tabs: { key: TabKey; label: string; count: string }[] = [
    { key: 'inclusions', label: 'Inclusions', count: String(inclusions.length) },
    ...(showAuth ? [{ key: 'authentication' as const, label: 'Authentication', count: `${doneAuth}/${authSteps.length}` }] : []),
    { key: 'photos', label: 'Photo Shoot', count: `${doneShots}/${shots.length}` },
  ]

  function handleTabKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = tabs[(index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]
    setSelected(next.key)
    document.getElementById(`${idBase}-tab-${next.key}`)?.focus()
  }

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900/40 flex flex-col min-h-0 min-w-0">
      <div role="tablist" aria-label="Listing checklists" className="flex border-b border-gray-800 px-3 gap-4 flex-none overflow-x-auto">
        {tabs.map((t, i) => {
          const on = t.key === tab
          return (
            <button
              key={t.key}
              id={`${idBase}-tab-${t.key}`}
              role="tab"
              type="button"
              aria-selected={on}
              aria-controls={`${idBase}-panel`}
              tabIndex={on ? 0 : -1}
              onClick={() => setSelected(t.key)}
              onKeyDown={(e) => handleTabKeyDown(e, i)}
              className={`py-2 text-[11px] font-semibold uppercase tracking-wider border-b-2 -mb-px whitespace-nowrap transition-colors ${
                on ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {t.label} <span className="ml-1 text-gray-600 normal-case font-normal">{t.count}</span>
            </button>
          )
        })}
      </div>
      <div
        key={tab}
        id={`${idBase}-panel`}
        role="tabpanel"
        aria-labelledby={`${idBase}-tab-${tab}`}
        className="flex-1 min-h-0 max-h-[340px] overflow-y-auto p-3"
      >
        {tab === 'inclusions' && (
          <InclusionsTab
            inclusions={inclusions}
            category={listing.category ?? ''}
            subType={listing.sub_type}
            onAdd={addInclusion}
            onConfirm={(i) => void saveInclusions(inclusions.map((item, idx) => (idx === i ? { ...item, confirmed: true } : item)))}
            onRemove={(i) => void saveInclusions(inclusions.filter((_, idx) => idx !== i))}
          />
        )}
        {tab === 'authentication' && (
          <AuthenticationTab steps={authSteps} saving={savingAuth} onToggle={toggleStep} onSkipAll={skipAllAuth} />
        )}
        {tab === 'photos' && (
          <PhotoShootTab
            shots={shots}
            onToggle={(name) => void toggleShot(name)}
            showRefresh={!photosConfirmed && inclusions.some((i) => !i.confirmed)}
            refreshing={refreshingPlan}
            onRefresh={() => void refreshPhotoPlan()}
          />
        )}
      </div>
    </section>
  )
}
