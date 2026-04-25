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
