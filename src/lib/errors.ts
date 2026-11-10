import crypto from "crypto";

export function newRequestId(): string {
  return `req_${crypto.randomBytes(8).toString("hex")}`;
}

/** Base class for errors the app raises intentionally, carrying a request ID so a failure can be traced from an API response back to server logs. */
export class AppError extends Error {
  readonly code: string;
  readonly requestId: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400, requestId = newRequestId()) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.requestId = requestId;
  }

  toJSON() {
    return { error: this.code, message: this.message, requestId: this.requestId };
  }
}

export class WebhookVerificationError extends AppError {
  constructor(message: string, requestId?: string) {
    super("webhook_verification_failed", message, 400, requestId);
    this.name = "WebhookVerificationError";
  }
}

export class ProviderUnavailableError extends AppError {
  constructor(message: string, requestId?: string) {
    super("provider_unavailable", message, 502, requestId);
    this.name = "ProviderUnavailableError";
  }
}
