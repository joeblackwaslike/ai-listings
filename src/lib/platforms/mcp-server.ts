/**
 * Platform SDK MCP server.
 *
 * Exposes all platform adapter operations as MCP tools, allowing Claude agents
 * to cross-list items, check orders, reply to buyers, and search comps without
 * leaving the chat session.
 *
 * Usage as stdio MCP server (add to .claude/settings.json or Claude Desktop):
 *   npx tsx src/lib/platforms/mcp-server.ts
 *
 * Usage as HTTP tool endpoint: see src/app/api/platforms/mcp/route.ts
 */

import { EbayAdapter } from './adapters/ebay';
import { PoshmarkAdapter } from './adapters/poshmark';
import { MercariAdapter } from './adapters/mercari';
import { EtsyAdapter } from './adapters/etsy';
import { MechmarketAdapter } from './adapters/mechmarket';
import { TheRealRealAdapter } from './adapters/therealreal';
import {
  getEbayCreds,
  getPoshmarkCreds,
  getMercariCreds,
} from './credentials';
import type { PlatformSDK, UnifiedListing, TrackingInfo } from './types';

// ---- Tool definitions (Anthropic tool_use format) --------------------------

export const PLATFORM_TOOLS = [
  {
    name: 'platform_search_comps',
    description: 'Search sold comp listings on a resale platform to research pricing.',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: { type: 'string', description: 'Platform name: ebay, poshmark, mercari, etsy, mechmarket, therealreal' },
        user_id: { type: 'string', description: 'Authenticated user ID' },
        query: { type: 'string', description: 'Search query (brand + model)' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: ['platform', 'user_id', 'query'],
    },
  },
  {
    name: 'platform_create_listing',
    description: 'Create a listing on a resale platform.',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: { type: 'string' },
        user_id: { type: 'string' },
        listing: {
          type: 'object',
          description: 'UnifiedListing: { internalId, title, description, price (cents), condition, category, brand, imageUrls, platformFields }',
        },
      },
      required: ['platform', 'user_id', 'listing'],
    },
  },
  {
    name: 'platform_get_orders',
    description: 'Fetch recent orders from a resale platform.',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: { type: 'string' },
        user_id: { type: 'string' },
        since_hours: { type: 'number', description: 'How many hours back to look (default 24)' },
      },
      required: ['platform', 'user_id'],
    },
  },
  {
    name: 'platform_get_notifications',
    description: 'Fetch unread platform notifications (offers, order alerts, messages).',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: { type: 'string' },
        user_id: { type: 'string' },
        since_hours: { type: 'number', description: 'How many hours back to look (default 6)' },
      },
      required: ['platform', 'user_id'],
    },
  },
  {
    name: 'platform_get_threads',
    description: 'Fetch active message threads on a platform.',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: { type: 'string' },
        user_id: { type: 'string' },
      },
      required: ['platform', 'user_id'],
    },
  },
  {
    name: 'platform_send_message',
    description: 'Reply to a buyer message thread on a platform.',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: { type: 'string' },
        user_id: { type: 'string' },
        thread_id: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['platform', 'user_id', 'thread_id', 'body'],
    },
  },
  {
    name: 'platform_mark_shipped',
    description: 'Mark an order as shipped with tracking information.',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: { type: 'string' },
        user_id: { type: 'string' },
        order_id: { type: 'string' },
        carrier: { type: 'string', description: 'Carrier name: usps, ups, fedex, etc.' },
        tracking_number: { type: 'string' },
      },
      required: ['platform', 'user_id', 'order_id', 'carrier', 'tracking_number'],
    },
  },
] as const;

// ---- Adapter factory -------------------------------------------------------

async function getAdapter(platform: string, userId: string): Promise<PlatformSDK> {
  switch (platform) {
    case 'ebay': {
      const creds = await getEbayCreds(userId);
      if (!creds) throw new Error('eBay credentials not configured for this user');
      return new EbayAdapter(creds);
    }
    case 'poshmark': {
      const creds = await getPoshmarkCreds(userId);
      if (!creds) throw new Error('Poshmark credentials not configured for this user');
      return new PoshmarkAdapter(creds);
    }
    case 'mercari': {
      const creds = await getMercariCreds(userId);
      if (!creds) throw new Error('Mercari credentials not configured for this user');
      return new MercariAdapter(creds);
    }
    case 'etsy':
      return new EtsyAdapter(userId);
    case 'mechmarket':
      return new MechmarketAdapter(userId);
    case 'therealreal':
      return new TheRealRealAdapter(userId);
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

// ---- Tool dispatcher -------------------------------------------------------

export interface ToolCallInput {
  name: string;
  input: Record<string, unknown>;
}

export async function dispatchToolCall(call: ToolCallInput): Promise<unknown> {
  const { name, input } = call;
  const platform = input.platform as string;
  const userId = input.user_id as string;

  if (!platform || !userId) throw new Error('platform and user_id are required');

  const adapter = await getAdapter(platform, userId);

  switch (name) {
    case 'platform_search_comps':
      return adapter.searchSoldComps(input.query as string, {
        limit: (input.limit as number | undefined) ?? 20,
      });

    case 'platform_create_listing':
      return adapter.createListing(input.listing as UnifiedListing);

    case 'platform_get_orders': {
      const sinceHours = (input.since_hours as number | undefined) ?? 24;
      return adapter.getOrders(new Date(Date.now() - sinceHours * 60 * 60 * 1000));
    }

    case 'platform_get_notifications': {
      const sinceHours = (input.since_hours as number | undefined) ?? 6;
      return adapter.getNotifications(new Date(Date.now() - sinceHours * 60 * 60 * 1000));
    }

    case 'platform_get_threads':
      return adapter.getThreads();

    case 'platform_send_message':
      await adapter.sendMessage(input.thread_id as string, input.body as string);
      return { ok: true };

    case 'platform_mark_shipped': {
      const tracking: TrackingInfo = {
        carrier: input.carrier as string,
        trackingNumber: input.tracking_number as string,
      };
      await adapter.markShipped(input.order_id as string, tracking);
      return { ok: true };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---- Stdio MCP server (JSON-RPC 2.0) ---------------------------------------

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

function reply(id: string | number | null, result?: unknown, error?: { code: number; message: string }): void {
  const response: JsonRpcResponse = { jsonrpc: '2.0', id, ...(error ? { error } : { result }) };
  process.stdout.write(JSON.stringify(response) + '\n');
}

async function handleRequest(req: JsonRpcRequest): Promise<void> {
  const { id, method, params } = req;

  if (method === 'initialize') {
    reply(id, {
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'ai-listings-platform-sdk', version: '1.0.0' },
      capabilities: { tools: {} },
    });
    return;
  }

  if (method === 'tools/list') {
    reply(id, { tools: PLATFORM_TOOLS });
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params as { name: string; arguments: Record<string, unknown> };
    try {
      const result = await dispatchToolCall({ name, input: args });
      reply(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reply(id, undefined, { code: -32603, message });
    }
    return;
  }

  reply(id, undefined, { code: -32601, message: `Method not found: ${method}` });
}

// Only start stdio listener when run directly
if (require.main === module) {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const req = JSON.parse(trimmed) as JsonRpcRequest;
        void handleRequest(req);
      } catch {
        reply(null, undefined, { code: -32700, message: 'Parse error' });
      }
    }
  });
  process.stdin.on('end', () => process.exit(0));
}
