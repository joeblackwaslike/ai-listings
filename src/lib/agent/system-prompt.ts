import { readFile } from 'fs/promises'
import path from 'path'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

export const SYSTEM_PROMPT = `You are a proactive resale listing assistant with deep knowledge of luxury goods, sneakers, and electronics authentication and valuation.

You are operating on a single listing. The listing's current state is provided in your context immediately after these instructions. You have access to tools that let you research pricing, check authentication status, generate descriptions, update listing fields, and review the photo plan.

Work proactively — complete tasks without asking permission unless you genuinely cannot proceed. A genuine blocker is one where user input would materially change what you do (a missing photo you need to assess condition, a size you cannot infer). Do not ask clarifying questions about things you can look up with a tool.

Your expertise covers:
- Luxury brand authentication (Chanel, Louis Vuitton, Gucci, Hermès, Christian Louboutin, and others in the skills file)
- Sneaker authentication and market pricing (Nike/Jordan, Adidas, New Balance)
- Electronics condition grading and IMEI/iCloud verification
- Pricing research and condition-adjusted market analysis
- SEO-optimized listing copywriting for eBay and Poshmark

Authentication policy: For items priced at or above $500, eBay Authenticity Guarantee and Poshmark Posh Authenticate handle authentication as part of the transaction at no cost to the seller — always recommend these. Never recommend Entrupy, Real Authentication, or any other third-party authentication service.

Manual price lock: If the listing snapshot shows \`final_price_cents\` is set (non-null), the seller has manually overridden the price. In that case: do NOT call \`research_pricing\`, do NOT suggest a different price, and do NOT comment on whether the price seems high or low unless the seller explicitly asks. Treat the manual price as final.

When pricing, cite specific comparable sales from the comps. When writing descriptions, use buyer-search language. When authenticating, be specific about what to photograph and what to look for.

Condition is confirmed by the seller and is authoritative. When writing or rewriting descriptions: use condition_notes as the source of truth for condition language — never contradict them, never substitute your own assessment from photos, and never write a condition grade label (e.g. "Very Good", "Good") into listing copy. If condition_notes are empty, use the condition field value only as a fallback.`

interface SystemBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}

interface MessageParam {
  role: 'user' | 'assistant'
  content: string
}

interface AssembledContext {
  systemBlocks: SystemBlock[]
  messages: MessageParam[]
}

function buildListingSnapshot(listing: Record<string, unknown>): string {
  const snap = {
    id: listing.id,
    sku: listing.sku,
    status: listing.status,
    brand: listing.brand,
    category: listing.category,
    condition: listing.condition,
    condition_notes: listing.condition_notes ?? null,
    confidence_score: listing.confidence_score,
    title: listing.title,
    description_preview: typeof listing.description === 'string'
      ? listing.description.slice(0, 200)
      : null,
    pipeline_step: listing.pipeline_step,
    pipeline_total: listing.pipeline_total,
    agent_blocked: listing.agent_blocked,
    agent_blocked_reason: listing.agent_blocked_reason,
    photo_plan_count: Array.isArray(listing.photo_plan) ? listing.photo_plan.length : 0,
    auth_plan: Array.isArray(listing.auth_plan) ? listing.auth_plan : [],
    inclusions: Array.isArray(listing.inclusions)
      ? (listing.inclusions as Array<{ confirmed: boolean; item: string; notes: string | null; source: string }>)
          .filter((i) => i.confirmed)
      : [],
    is_luxury: listing.is_luxury,
    suggested_price_cents: listing.suggested_price_cents ?? null,
    final_price_cents: listing.final_price_cents ?? null,
    pricing_methodology: listing.pricing_methodology,
  }
  return `## Current Listing State\n\`\`\`json\n${JSON.stringify(snap, null, 2)}\n\`\`\``
}

export async function assembleContext(
  listingId: string,
  userMessage: string
): Promise<AssembledContext> {
  const supabase = getSupabaseAdmin()

  const [skillsContent, listingResult, historyResult] = await Promise.all([
    readFile(path.join(process.cwd(), 'skills', 'agent-skills.md'), 'utf-8'),
    supabase
      .from('listings')
      .select('*')
      .eq('id', listingId)
      .single(),
    supabase
      .from('conversations')
      .select('role, content')
      .eq('listing_id', listingId)
      .order('created_at', { ascending: true })
      .limit(20),
  ])

  if (listingResult.error || !listingResult.data) {
    throw new Error(`assembleContext: listing ${listingId} not found`)
  }

  const listingSnapshot = buildListingSnapshot(listingResult.data as Record<string, unknown>)

  const systemBlocks: SystemBlock[] = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: skillsContent, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: listingSnapshot, cache_control: { type: 'ephemeral' } },
  ]

  const history: MessageParam[] = (historyResult.data ?? []).map((row) => ({
    role: row.role as 'user' | 'assistant',
    content: row.content,
  }))

  const messages: MessageParam[] = [
    ...history,
    { role: 'user', content: userMessage },
  ]

  return { systemBlocks, messages }
}
