import type { Env } from './types';

declare global {
  namespace App {
    interface Platform { env: Env; context: ExecutionContext; caches: CacheStorage }
  }
}
export {};
