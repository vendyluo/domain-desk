export interface Env {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
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
