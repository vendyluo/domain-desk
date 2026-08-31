export interface Env {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
  EMAIL?: SendEmail;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  LOCAL_DEV: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
}

export class IngestError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}
