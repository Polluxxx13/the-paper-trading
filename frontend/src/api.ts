export interface Account {
  slug: 'main' | 'test';
  name: string;
  color: string;
  baseCurrency: 'USD' | 'CHF';
  initialCapital: number;
  cash: number;
  spreadBps: number;
  feeFixed: number;
  feePct: number;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Fetch JSON avec cookie de session ; lève ApiError avec le message du serveur. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.message ?? `Erreur ${res.status}`);
  return data as T;
}
