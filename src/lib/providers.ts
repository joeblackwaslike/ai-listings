export const PROVIDERS = [
  { id: 'anthropic' as const, label: 'Anthropic', placeholder: 'sk-ant-api03-...' },
  { id: 'serpapi' as const,   label: 'SerpAPI',   placeholder: 'serpapi key' },
  { id: 'photoroom' as const, label: 'PhotoRoom', placeholder: 'photoroom key' },
] as const

export type ProviderId = (typeof PROVIDERS)[number]['id']

export const VALID_PROVIDER_IDS: readonly string[] = PROVIDERS.map((p) => p.id)
