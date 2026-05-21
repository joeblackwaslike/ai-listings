# mechmarket Integration Design

**Date**: 2026-05-20
**Status**: Design
**Parent**: [Reseller SDK Architecture](./2026-05-20-reseller-sdk-architecture-design.md)

---

## Overview

mechmarket (r/mechmarket) is a Reddit subreddit for buying and selling mechanical keyboards and related gear. Unlike traditional e-commerce platforms, it uses Reddit posts as listings. This creates a fundamentally different integration model.

**Key constraints:**

- 48-hour cooldown between personal posts (subreddit rule, not Reddit API limit)
- All items for sale go in **one aggregated post** — not per-item posts
- Items are added by editing the existing post
- Re-promotion every 4-5 days (comment "Still available" or repost after cooldown)
- Each item needs a **timestamp photo every 14 days** — physical item + handwritten Reddit handle + current date on paper
- Timestamp photos must be uploaded to Imgur

---

## SDK Dependencies

```
snoowrap          # Reddit API wrapper (TypeScript, OAuth2)
imgur             # Imgur API client (image/album upload)
```

**Reddit app registration**: `reddit.com/prefs/apps` → "script" type for personal use.

**Credentials** (stored in `user_api_keys` + `user_settings`):

| Key | Store | Type |
|-----|-------|------|
| `reddit_client_id` | `user_api_keys` | credential |
| `reddit_client_secret` | `user_api_keys` | credential |
| `reddit_refresh_token` | `user_settings` | credential |
| `reddit_username` | `user_settings` | string |
| `us_state` | `user_settings` | string |
| `imgur_client_id` | `user_api_keys` | credential |
| `imgur_access_token` | `user_settings` | credential |
| `imgur_refresh_token` | `user_settings` | credential |

---

## Data Model

mechmarket requires a **post-level** data model, not listing-level.

```sql
-- One mechmarket post per seller (enforced by 48h cooldown)
CREATE TABLE mechmarket_posts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  reddit_post_id text UNIQUE,       -- Reddit fullname (t3_xxxxx)
  reddit_post_url text,
  last_promoted_at timestamptz,
  next_eligible_post_at timestamptz, -- last_promoted_at + 48h
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Items included in the mechmarket post
CREATE TABLE mechmarket_post_items (
  post_id uuid REFERENCES mechmarket_posts(id) ON DELETE CASCADE,
  listing_id uuid REFERENCES listings(id) ON DELETE CASCADE,
  timestamp_photo_url text,            -- Imgur direct link
  timestamp_imgur_album_url text,       -- Imgur album link (if multiple photos)
  timestamp_taken_at timestamptz,       -- Must be within 14 days of posting
  timestamp_expires_at timestamptz GENERATED ALWAYS AS (timestamp_taken_at + interval '14 days') STORED,
  status text DEFAULT 'active' CHECK (status IN ('active', 'sold', 'removed')),
  sort_order int DEFAULT 0,
  added_at timestamptz DEFAULT now(),
  PRIMARY KEY (post_id, listing_id)
);
```

---

## SDK Implementation

### File: `src/lib/platforms/adapters/mechmarket.ts`

```typescript
// Core operations this adapter implements:

// searchSoldComps(query) → search r/mechmarket for [H] posts matching keyboard name
//   - snoowrap: r.getSubreddit('mechmarket').search({ query: `[H] ${query}`, sort: 'new', limit: 25 })
//   - Claude parses price from post title/body text (pass top results to Claude for extraction)

// createPost(items: MechmarketItem[]) → submit new aggregated Reddit post
//   - Check cooldown: query mechmarket_posts for last post time
//   - If < 48h since last post → throw CooldownError with time remaining
//   - Build post body from template (see Post Format below)
//   - snoowrap: r.getSubreddit('mechmarket').submitSelfpost({ title, text })
//   - Store returned post.id in mechmarket_posts

// updatePost(postId, items) → edit existing post body to add/remove/update items
//   - snoowrap: r.getSubmission(redditPostId).edit(newBody)
//   - Updates mechmarket_post_items

// addItem(postId, listingId, timestampPhotoUrl) → add item to existing post
//   - Insert into mechmarket_post_items
//   - Regenerate post body → call updatePost

// markItemSold(postId, listingId) → update item status to 'sold', update post body

// uploadTimestampPhoto(imageBuffer: Buffer) → ImgurClient.upload() → returns Imgur URL
//   - Validates: image must be <20MB
//   - Refreshes Imgur token if expired

// getThreads() → snoowrap: r.getInbox({ filter: 'messages' })
// getThread(threadId) → retrieve message thread
// sendMessage(threadId, body) → snoowrap: message.reply(body)

// getNotifications() → snoowrap: r.getUnreadMessages() → map to PlatformNotification
// markNotificationRead(id) → snoowrap: r.markMessagesAsRead([id])
```

### Timestamp Photo Validation

Before including a photo in a post, validate:
1. `timestamp_taken_at` is within 14 days of current date
2. If expired: flag item in `mechmarket_post_items`, surface warning in UI

### Cooldown Enforcement

Track `last_promoted_at` in `mechmarket_posts`. On `createPost()` or re-promote:
```typescript
const cooldownMs = 48 * 60 * 60 * 1000;
const elapsed = Date.now() - lastPromotedAt.getTime();
if (elapsed < cooldownMs) {
  throw new CooldownError(`Can post again in ${Math.ceil((cooldownMs - elapsed) / 3600000)}h`);
}
```

---

## Post Format

```
Timestamp album: https://imgur.com/a/xxxxx

**Prices shipped CONUS unless noted. PayPal G&S only.**

---

**[Item Name + Key Specs]**
Price: $XXX shipped / $XXX local (NYC)
Condition: [Like New / Lightly Used / Used]
Timestamp: https://i.imgur.com/xxxxx.jpg

[Description of item: switches, layout, build status, any flaws, includes]

---

**[Item 2 Name]**
Price: $XXX shipped
Condition: [condition]
Timestamp: https://i.imgur.com/yyyyy.jpg

[Description]
```

### Title Format

```
[US-{STATE}][H] {comma-separated item names} [W] PayPal
```

Example: `[US-NY][H] GMK Botanical TKL, Tofu65, Boba U4T switches [W] PayPal`

---

## Pricing Research

For keyboard sold comps, search r/mechmarket:

```
query: "[H] {keyboard name}"
sort: new
restrict_sr: true
limit: 25
```

Pass the top 10–15 post titles + bodies to Claude with prompt:
> "Extract the selling price for {keyboard name} from these mechmarket posts. Return an array of { title, price_cents, sold_at_approx } for any that appear to be actual sale listings."

Merge Reddit comps with eBay comps (both run in parallel for keyboards).

---

## Imgur Integration

### File: `src/lib/imgur.ts`

```typescript
// uploadImage(buffer: Buffer, mimeType: string, accessToken: string): Promise<string>
//   → returns direct image URL (i.imgur.com/xxxxx.jpg)

// createAlbum(title: string, imageUrls: string[], accessToken: string): Promise<string>
//   → returns album URL (imgur.com/a/xxxxx)

// refreshToken(clientId: string, clientSecret: string, refreshToken: string): Promise<{ accessToken, refreshToken }>
```

Imgur OAuth flow: `imgur.com/oauth2/authorize` → user grants access → callback with code → exchange for tokens → store in `user_settings`.

---

## Seller Dashboard Integration

### Notification Panel entries for mechmarket

| Event | Notification Type | Action on Click |
|-------|------------------|-----------------|
| New Reddit DM | `reddit_message` | Open message thread |
| Item marked sold by buyer | `reddit_mention` | Open listing |
| Timestamp expiring in 2 days | `timestamp_warning` | Open mechmarket post manager |
| Cooldown expires (can repost) | `cooldown_expired` | Open mechmarket post manager |

### mechmarket Post Manager UI

New section in the seller dashboard: **mechmarket Post**

- Shows current post (if any): title, Reddit URL, posted X days ago
- List of items in the post: each with timestamp status (✓ valid / ⚠ expiring / ✗ expired)
- "Add item" button: select from ready listings
- "Update post" button: regenerates body + calls Reddit edit API
- "Re-promote" button (enabled after 48h): submits new post with current items
- Timestamp photo upload: drag photo → uploads to Imgur → stores URL

---

## Inngest Jobs

```typescript
// poll-reddit-inbox: every 5 min
//   → fetch unread Reddit messages → insert new ones to notifications table

// check-mechmarket-timestamps: every 6h
//   → find items where timestamp_expires_at < now() + 2 days
//   → create 'timestamp_warning' notifications

// check-mechmarket-cooldown: daily
//   → if 48h has passed since last post and active items exist
//   → create 'cooldown_expired' notification
```

---

## Rules Reference (for embedding in step4a + system-prompt)

```
mechmarket Posting Rules:
- Title: [US-{STATE}][H] {items} [W] PayPal
- Timestamp photo (MANDATORY, per item):
    • Physical item visible
    • Handwritten note: Reddit username + date (MM/DD/YYYY)
    • Photo must be taken within 14 days of posting
    • No digital timestamps — handwritten only
    • Must be first photo in album, link on first line of post body
- Price: explicit $ amount required (e.g. "$450 shipped CONUS")
- 48-hour cooldown between personal posts (edit existing post to add items)
- Re-promote every 4-5 days; new timestamp photo per item every 14 days
- [H] = Have (selling), [W] = Want (payment), WTS = Want To Sell
- Flair is earned from confirmed community trades
```
