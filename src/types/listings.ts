export type ListingStatus =
  | 'intake'
  | 'id_gate'
  | 'gender_gate'
  | 'in_loop'
  | 'finalizing'
  | 'published'
  | 'archived';

export type ListingCategory =
  | 'handbag'
  | 'small_leather_goods'
  | 'clothing'
  | 'sneakers'
  | 'electronics'
  | 'jewelry'
  | 'collectibles'
  | 'watches'
  | 'keyboards'
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

export type CompSource =
  | 'ebay' | 'ebay_active'
  | 'poshmark' | 'poshmark_active'
  | 'therealreal' | 'therealreal_active'
  | 'google' | 'google_active'
  | 'mercari' | 'mercari_active'
  | 'reddit';

// Which underlying API/data provider produced the comp row -- distinct from `source`
// (which platform it's from). A single source like 'ebay_active' can come from either
// the official Browse API or the SerpAPI fallback, so `source` alone can't answer
// "which of our data providers is actually working."
export type CompProvider = 'soldcomps' | 'ebay_browse' | 'serpapi' | 'poshmark_direct' | 'reddit_claude';

export type ConversationRole = 'user' | 'assistant';

export const CATEGORY_PREFIXES: Record<ListingCategory, string> = {
  handbag: 'HB',
  small_leather_goods: 'SL',
  clothing: 'CL',
  sneakers: 'SN',
  electronics: 'EL',
  jewelry: 'JW',
  collectibles: 'CO',
  watches: 'WA',
  keyboards: 'KB',
  other: 'OT',
};

export type InclusionSource = 'detected' | 'manual';
export type TagState = 'attached' | 'severed';
export type AuthCardSource = 'original' | 'reseller' | 'third_party';

export interface Inclusion {
  item: string;
  source: InclusionSource;
  confirmed: boolean;
  notes: string | null;
  tagState?: TagState;
  docSource?: AuthCardSource;
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

// Always inches -- no unit suffix needed on the individual fields since, unlike jewelry's
// mixed mm/in measurements, everything in this shape is the same unit.
export interface ShippingBoxDims {
  length: number;
  width: number;
  height: number;
}

export interface PlatformFields {
  ebay?: {
    title: string;
    category_id: string;
    item_specifics: Record<string, string>;
    condition_id: string;
    description: string;
    // Populated by /api/listings/[id]/post-to-ebay after a successful createListing call.
    ebay_listing_id?: string;
    ebay_offer_id?: string;
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

export type ClothingSubType =
  | 'jeans'
  | 'pants'
  | 'pants_formal'
  | 'shorts'
  | 'tshirt'
  | 'shirt'
  | 'dress'
  | 'jacket'
  | 'skirt'
  | 'other';

export type JewelrySubType =
  | 'ring'
  | 'bangle'
  | 'bracelet'
  | 'necklace'
  | 'earrings'
  | 'pendant'
  | 'brooch'
  | 'other';

export interface Measurements {
  // clothing
  waist?: number;
  inseam?: number;
  chest?: number;
  sleeve?: number;
  length?: number;
  bust?: number;
  hips?: number;
  rise?: 'low' | 'mid' | 'high';
  // bags / small leather goods / electronics / collectibles / any non-clothing item
  height?: number;
  width?: number;
  depth?: number;
  // sneakers
  us_size?: number;
  // Jewelry fields below embed their unit in the key name (_mm/_in), unlike
  // clothing's unitless keys (waist, chest, ...) -- jewelry mixes mm (ring/
  // bangle diameters) and inches (chain length) in the same interface, so
  // the suffix disambiguates at a glance without relying on the hint string.
  // jewelry: ring ("id" = inner diameter, not identifier)
  ring_inscribed_size?: string;
  ring_id_mm?: number;
  ring_id_widest_mm?: number;
  ring_id_narrowest_mm?: number;
  // jewelry: bangle ("id" = inner diameter, same as ring)
  bangle_id_mm?: number;
  // jewelry: necklace
  necklace_chain_length_in?: number;
  // sneakers: sizing system capture (us_size above stays the resolved value)
  shoe_size_system?: string;
  shoe_size_raw?: string;
  // sneakers: physical item dimensions -- one shoe of the pair, not the box. Only
  // sneakers get dedicated L/W/H fields; every other category without sub-type-specific
  // fields uses the generic width/height/depth above instead.
  item_length_in?: number;
  item_width_in?: number;
  item_height_in?: number;
  // shipping: computed estimate (padded item dims, or the real box below when known) --
  // never asked for directly. See computeEstimatedShippingBox in lib/sizing/shipping-box.ts.
  estimated_shipping_box?: ShippingBoxDims;
  // shipping: real box dimensions, filled in via the finalizing-gate checklist when the
  // original box is included -- overrides estimated_shipping_box when all three are known.
  box_length_in?: number;
  box_width_in?: number;
  box_height_in?: number;
  // general
  weight_oz?: number;
}

export interface MeasurementField {
  key: keyof Measurements;
  label: string;
  hint: string;
  textInput?: true;
  useChips?: true;
  chipOptions?: string[];
}

export interface DetailGateContext {
  category: string;
  categoryNeedsGender: boolean;
  subTypeHint: ClothingSubType | JewelrySubType | null;
  categoryNeedsMeasurements: boolean;
  measurementFields: MeasurementField[];
  defaultMeasurementValues?: Partial<Record<string, string | number>>;
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
  gender: string | null;
  item_size: string | null;
  sub_type: ClothingSubType | JewelrySubType | null;
  measurements: Measurements | null;
  tags: string[];
  inclusions: Inclusion[];

  suggested_price_cents: number | null;
  final_price_cents: number | null;
  confidence_score: number | null;

  price_to_move_cents: number | null;
  price_to_move_discount_pct: number | null;
  retail_price_cents: number | null;
  retail_price_source: string | null;
  retail_promo_note: string | null;
  lowest_active_price_cents: number | null;
  lowest_active_url: string | null;
  lowest_active_source: string | null;
  pricing_methodology: string | null;

  auth_plan: AuthStep[];
  photo_plan: PhotoShot[];
  platform_fields: PlatformFields;
  listing_urls: ListingUrls;

  agent_blocked: boolean;
  agent_blocked_reason: string | null;

  auto_discount_enabled: boolean | null;
  auto_discount_pct: number | null;
  auto_discount_interval_days: number | null;

  photos_confirmed: boolean;
  skip_background_removal: boolean;
  condition_confirmed: boolean;
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
  color: string | null;
  relevance_score: number | null;
  provider: CompProvider | null;
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

export interface ListingPriceEvent {
  id: string;
  listing_id: string;
  event_type: 'initial' | 'manual_change' | 'auto_discount' | 'relist';
  price_cents: number;
  note: string | null;
  created_at: string;
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
