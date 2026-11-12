interface KeyStatus {
  key: string;
  cooldownUntil: number;
  failureCount: number;
  successCount: number;
}

export class KeyPoolManager {
  private keyState: Map<string, KeyStatus[]> = new Map();
  private roundRobinIdx: Map<string, number> = new Map();

  public getKey(providerId: string, apiKeys: string[]): string | null {
    if (!apiKeys || apiKeys.length === 0) return null;
    if (apiKeys.length === 1) return apiKeys[0];

    let pool = this.keyState.get(providerId);
    if (!pool || pool.length !== apiKeys.length) {
      pool = apiKeys.map((k) => ({
        key: k,
        cooldownUntil: 0,
        failureCount: 0,
        successCount: 0,
      }));
      this.keyState.set(providerId, pool);
    }

    const now = Date.now();
    // Filter available keys (not in cooldown)
    const available = pool.filter((k) => k.cooldownUntil <= now);
    const candidatePool = available.length > 0 ? available : pool;

    const currentIdx = this.roundRobinIdx.get(providerId) || 0;
    const selected = candidatePool[currentIdx % candidatePool.length];
    this.roundRobinIdx.set(providerId, currentIdx + 1);

    return selected.key;
  }

  public reportRateLimit(providerId: string, key: string, cooldownSec = 60) {
    const pool = this.keyState.get(providerId);
    if (!pool) return;
    const target = pool.find((k) => k.key === key);
    if (target) {
      target.cooldownUntil = Date.now() + cooldownSec * 1000;
      target.failureCount++;
      console.warn(`[KeyPool] Provider ${providerId} key placed in cooldown for ${cooldownSec}s.`);
    }
  }

  public reportSuccess(providerId: string, key: string) {
    const pool = this.keyState.get(providerId);
    if (!pool) return;
    const target = pool.find((k) => k.key === key);
    if (target) {
      target.successCount++;
    }
  }
}

export const keyPool = new KeyPoolManager();
