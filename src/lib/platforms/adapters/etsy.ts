import type { PlatformSDK, PlatformComp, PlatformListing, PlatformOrder,
              PlatformNotification, PlatformMessage, PlatformThread,
              UnifiedListing, TrackingInfo } from '../types';
import { UnsupportedOperationError } from '../errors';

export class EtsyAdapter implements PlatformSDK {
  platform = 'etsy';

  async searchSoldComps(_query: string): Promise<PlatformComp[]> {
    throw new UnsupportedOperationError(this.platform, 'searchSoldComps');
  }

  async createListing(_listing: UnifiedListing): Promise<{ platformId: string; url: string }> {
    throw new UnsupportedOperationError(this.platform, 'createListing');
  }

  async updateListing(_platformId: string, _updates: Partial<UnifiedListing>): Promise<void> {
    throw new UnsupportedOperationError(this.platform, 'updateListing');
  }

  async deleteListing(_platformId: string): Promise<void> {
    throw new UnsupportedOperationError(this.platform, 'deleteListing');
  }

  async getListing(_platformId: string): Promise<PlatformListing> {
    throw new UnsupportedOperationError(this.platform, 'getListing');
  }

  async getMyListings(): Promise<PlatformListing[]> {
    throw new UnsupportedOperationError(this.platform, 'getMyListings');
  }

  async getOrders(): Promise<PlatformOrder[]> {
    throw new UnsupportedOperationError(this.platform, 'getOrders');
  }

  async getOrder(_orderId: string): Promise<PlatformOrder> {
    throw new UnsupportedOperationError(this.platform, 'getOrder');
  }

  async markShipped(_orderId: string, _tracking: TrackingInfo): Promise<void> {
    throw new UnsupportedOperationError(this.platform, 'markShipped');
  }

  async getNotifications(): Promise<PlatformNotification[]> {
    throw new UnsupportedOperationError(this.platform, 'getNotifications');
  }

  async markNotificationRead(_notificationId: string): Promise<void> {
    throw new UnsupportedOperationError(this.platform, 'markNotificationRead');
  }

  async getThreads(): Promise<PlatformThread[]> {
    throw new UnsupportedOperationError(this.platform, 'getThreads');
  }

  async getThread(_threadId: string): Promise<PlatformMessage[]> {
    throw new UnsupportedOperationError(this.platform, 'getThread');
  }

  async sendMessage(_threadId: string, _body: string): Promise<void> {
    throw new UnsupportedOperationError(this.platform, 'sendMessage');
  }
}
