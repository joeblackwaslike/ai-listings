import type { PlatformSDK } from './types';

const registry = new Map<string, () => Promise<PlatformSDK>>();

export function registerPlatform(name: string, factory: () => Promise<PlatformSDK>): void {
  registry.set(name, factory);
}

export async function getPlatformSDK(name: string): Promise<PlatformSDK> {
  const factory = registry.get(name);
  if (!factory) throw new Error(`Unknown platform: ${name}`);
  return factory();
}

export function getRegisteredPlatforms(): string[] {
  return Array.from(registry.keys());
}
