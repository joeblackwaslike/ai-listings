export interface PlatformListing {
  platform: string;
  platformId: string;
  url: string;
  title: string;
  price: number; // cents
  status: 'active' | 'sold' | 'removed' | 'draft';
  createdAt: Date;
  updatedAt: Date;
  raw: Record<string, unknown>;
}

export interface PlatformComp {
  platform: string;
  title: string;
  soldPrice: number; // cents
  condition: string;
  url: string;
  soldAt: Date | null;
}

export interface PlatformOrder {
  platform: string;
  orderId: string;
  listingId: string;
  buyerUsername: string;
  salePrice: number; // cents
  status: 'pending' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
  createdAt: Date;
  shippingAddress?: string;
  trackingNumber?: string;
}

export interface PlatformNotification {
  platform: string;
  notificationId: string;
  type: 'offer' | 'order' | 'message' | 'question' | 'shipped' | 'other';
  title: string;
  preview: string;
  url?: string;
  read: boolean;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

export interface PlatformMessage {
  platform: string;
  threadId: string;
  messageId: string;
  from: string;
  body: string;
  sentAt: Date;
  read: boolean;
}

export interface PlatformThread {
  platform: string;
  threadId: string;
  withUser: string;
  lastMessage: PlatformMessage;
  unreadCount: number;
  listingId?: string;
}

export interface UnifiedListing {
  internalId: string;
  title: string;
  description: string;
  price: number; // cents
  condition: string;
  category: string;
  brand: string;
  imageUrls: string[];
  platformFields: Record<string, unknown>;
}

export interface TrackingInfo {
  carrier: string;
  trackingNumber: string;
}

export interface PlatformSDK {
  platform: string;

  searchSoldComps(query: string, options?: { limit?: number }): Promise<PlatformComp[]>;

  createListing(listing: UnifiedListing): Promise<{ platformId: string; url: string }>;
  updateListing(platformId: string, updates: Partial<UnifiedListing>): Promise<void>;
  deleteListing(platformId: string): Promise<void>;
  getListing(platformId: string): Promise<PlatformListing>;
  getMyListings(filters?: { status?: string }): Promise<PlatformListing[]>;

  getOrders(since?: Date): Promise<PlatformOrder[]>;
  getOrder(orderId: string): Promise<PlatformOrder>;
  markShipped(orderId: string, tracking: TrackingInfo): Promise<void>;

  getNotifications(since?: Date): Promise<PlatformNotification[]>;
  markNotificationRead(notificationId: string): Promise<void>;

  getThreads(): Promise<PlatformThread[]>;
  getThread(threadId: string): Promise<PlatformMessage[]>;
  sendMessage(threadId: string, body: string): Promise<void>;
  replyToOffer?(offerId: string, action: 'accept' | 'decline' | 'counter', counterPrice?: number): Promise<void>;
}
