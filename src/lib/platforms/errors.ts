export class PlatformError extends Error {
  constructor(public platform: string, message: string) {
    super(`[${platform}] ${message}`);
    this.name = 'PlatformError';
  }
}

export class UnsupportedOperationError extends PlatformError {
  constructor(platform: string, operation: string) {
    super(platform, `${operation} is not supported`);
    this.name = 'UnsupportedOperationError';
  }
}

export class CooldownError extends PlatformError {
  constructor(platform: string, message: string) {
    super(platform, message);
    this.name = 'CooldownError';
  }
}

export class AuthExpiredError extends PlatformError {
  constructor(platform: string) {
    super(platform, 'Authentication expired — please re-authenticate');
    this.name = 'AuthExpiredError';
  }
}

export class NotFoundError extends PlatformError {
  constructor(platform: string, resource: string) {
    super(platform, `${resource} not found`);
    this.name = 'NotFoundError';
  }
}
