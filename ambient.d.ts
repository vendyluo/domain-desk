declare module '*.sql?raw' { const value: string; export default value; }
declare module '*cloudflare/_worker.js' { const worker: ExportedHandler<Cloudflare.Env>; export default worker; }
declare namespace Cloudflare { interface Env { DB: D1Database; ATTACHMENTS: R2Bucket; LOCAL_DEV: string; ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string } }
