/** A short-lived, bounded cache owned by one mounted reporting workspace. Never persisted or shared across accounts. */
export class DashboardRequestCache {
  private entries = new Map<string, { expiresAt: number; promise: Promise<unknown> }>();
  private maximumEntries: number;
  private ttlMilliseconds: number;
  private now: () => number;
  constructor(maximumEntries = 48, ttlMilliseconds = 60_000, now = () => Date.now()) { this.maximumEntries = maximumEntries; this.ttlMilliseconds = ttlMilliseconds; this.now = now; }

  get<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > this.now()) return existing.promise as Promise<T>;
    this.entries.delete(key);
    const entry = { expiresAt: this.now() + this.ttlMilliseconds, promise: Promise.resolve().then(load) as Promise<unknown> };
    this.entries.set(key, entry);
    while (this.entries.size > this.maximumEntries) this.entries.delete(this.entries.keys().next().value!);
    void entry.promise.catch(() => { if (this.entries.get(key) === entry) this.entries.delete(key); });
    return entry.promise as Promise<T>;
  }

  clear() { this.entries.clear(); }
}
