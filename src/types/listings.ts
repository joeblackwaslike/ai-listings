export type ListingStatus =
  | 'intake'
  | 'id_gate'
  | 'in_loop'
  | 'finalizing'
  | 'published'
  | 'archived';

export type ListingCategory =
  | 'handbag'
  | 'clothing'
  | 'sneakers'
  | 'electronics'
  | 'jewelry'
  | 'collectibles'
  | 'other';

export type ConditionValue =
  | 'new_with_tags'
  | 'new_without_tags'
  | 'like_new'
  | 'very_good'
  | 'good'
  | 'fair'
  | 'poor'
  | 'for_parts';

export type PhotoType = 'intake' | 'processed' | 'auth_card' | 'studio';

export type CompSource = 'ebay' | 'poshmark' | 'therealreal' | 'google';

export type ConversationRole = 'user' | 'assistant';

export const CATEGORY_PREFIXES: Record<ListingCategory, string> = {
  handbag: 'HB',
  clothing: 'CL',
  sneakers: 'SN',
  electronics: 'EL',
  jewelry: 'JW',
  collectibles: 'CO',
  other: 'OT',
};

export interface Inclusion {
  item: string;
  included: boolean;
  notes: string | null;
}

export interface AuthStep {
  step: string;
  guidance: string;
  status: 'pending' | 'done' | 'failed';
  photo_required: boolean;
}

export interface PhotoShot {
  shot: string;
  description: string;
  required: boolean;
  photo_type: PhotoType;
}

export interface PlatformFields {
  ebay?: {
    title: string;
    category_id: string;
    item_specifics: Record<string, string>;
    condition_id: string;
    description: string;
  };
  poshmark?: {
    title: string;
    category: string;
    size: string;
    description: string;
    original_price?: number;
  };
  [platform: string]: Record<string, unknown> | undefined;
}

export interface ListingUrls {
  ebay?: string;
  poshmark?: string;
  mercari?: string;
  [platform: string]: string | undefined;
}

export interface Listing {
  id: string;
  sku: string | null;

  status: ListingStatus;
  pipeline_step: number;
  pipeline_total: number;

  title: string | null;
  description: string | null;
  category: ListingCategory | null;
  brand: string | null;
  condition: ConditionValue | null;
  condition_notes: string | null;
  tags: string[];
  inclusions: Inclusion[];

  suggested_price_cents: number | null;
  final_price_cents: number | null;
  confidence_score: number | null;

  auth_plan: AuthStep[];
  photo_plan: PhotoShot[];
  platform_fields: PlatformFields;
  listing_urls: ListingUrls;

  agent_blocked: boolean;
  agent_blocked_reason: string | null;

  is_luxury: boolean;
  intake_meta: Record<string, unknown> | null;

  created_at: string;
  updated_at: string;
}

export interface Photo {
  id: string;
  listing_id: string;
  type: PhotoType;
  raw_url: string;
  processed_url: string | null;
  display_order: number;
  photoroom_meta: Record<string, unknown> | null;
  created_at: string;
}

export interface PricingComp {
  id: string;
  listing_id: string;
  source: CompSource;
  title: string;
  sale_price_cents: number;
  condition: string;
  sold_at: string;
  listing_url: string;
  condition_delta: 'same' | 'better' | 'worse';
  adjusted_price_cents: number;
  created_at: string;
}

export interface Conversation {
  id: string;
  listing_id: string;
  role: ConversationRole;
  content: string;
  context_snapshot: Record<string, unknown> | null;
  created_at: string;
}

export interface PricingResearch {
  ok: true;
  suggestedPrice: number;
  confidence: number;
  confidenceSummary: string;
  comps: Array<{
    source: string;
    title: string;
    price: number;
    condition: string;
    conditionDelta: 'same' | 'better' | 'worse';
    adjustedPrice: number;
    soldDaysAgo: number;
    url: string;
  }>;
  evidence: string;
}

export interface AuthChecklist {
  ok: true;
  passed: boolean;
  confidence: 'high' | 'medium' | 'low';
  steps: Array<{
    step: string;
    guidance: string;
    status: 'pending' | 'done' | 'failed';
    photoRequired: boolean;
  }>;
  platformAuth: {
    eligible: boolean;
    platform: 'ebay' | 'poshmark' | null;
    threshold: number;
    note: string;
  };
}

export interface ListingDescription {
  ok: true;
  canonical: string;
  seoKeywords: string[];
  platforms: Array<{
    platform: 'ebay' | 'poshmark';
    title: string;
    description: string;
    characterCount: number;
  }>;
}

export type AgentToolError = { ok: false; reason: string };

export type PricingResearchResult = PricingResearch | AgentToolError;
export type AuthChecklistResult = AuthChecklist | AgentToolError;
export type ListingDescriptionResult = ListingDescription | AgentToolError;
