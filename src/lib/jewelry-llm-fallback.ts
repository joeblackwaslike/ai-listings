import { runStructured } from '@/lib/claude'
import type { ApiKeys } from '@/lib/user-api-keys'
import type { JewelrySubType } from '@/types/listings'

const VALID_SUB_TYPES: JewelrySubType[] = ['ring', 'bangle', 'bracelet', 'necklace', 'earrings', 'pendant', 'brooch', 'other']

export async function classifyJewelrySubTypeWithLlm(
  notableFeatures: string[],
  apiKeys: ApiKeys
): Promise<JewelrySubType | null> {
  const result = await runStructured<{ sub_type: string }>({
    model: 'claude-haiku-4-5',
    apiKey: apiKeys.anthropic,
    maxTokens: 100,
    toolName: 'classify_jewelry_sub_type',
    toolDescription: 'Classify a jewelry item into a sub-type based on its description.',
    prompt: `Classify this jewelry item into exactly one sub-type based on its description. Respond with one of: ${VALID_SUB_TYPES.join(', ')}.\n\nDescription:\n${notableFeatures.join('\n')}`,
    jsonSchema: {
      type: 'object',
      properties: {
        sub_type: { type: 'string', enum: VALID_SUB_TYPES },
      },
      required: ['sub_type'],
    },
  })
  return VALID_SUB_TYPES.includes(result.sub_type as JewelrySubType) ? (result.sub_type as JewelrySubType) : null
}
