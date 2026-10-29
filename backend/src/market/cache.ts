/** Cache TTL avec "single-flight" : des appels concurrents identiques partagent une seule requête Yahoo. */
export class TtlCache<V> {
  private store = new Map<string, { value: V; expires: number }>();
  private inflight = new Map<string, Promise<V>>();

  constructor(private maxEntries = 500) {}

  async getOrLoad(key: string, ttlMs: number, loader: () => Promise<V>): Promise<V> {
    const hit = this.store.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const p = loader()
      .then((value) => {
        if (this.store.size >= this.maxEntries) this.store.delete(this.store.keys().next().value as string);
        this.store.set(key, { value, expires: Date.now() + ttlMs });
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}
