import { useState } from 'react';
import { api } from './api';

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/login', { method: 'POST', body: { password } });
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full flex items-center justify-center">
      <form onSubmit={submit} className="w-80 bg-tv-panel border border-tv-border rounded-lg p-6 space-y-4">
        <h1 className="text-lg font-semibold">Paper Trading</h1>
        <input
          type="password"
          autoFocus
          placeholder="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-tv-bg border border-tv-border rounded px-3 py-2 outline-none focus:border-tv-blue"
        />
        {error && <p className="text-tv-down text-sm">{error}</p>}
        <button disabled={busy || !password} className="w-full bg-tv-blue rounded py-2 font-medium disabled:opacity-50">
          Se connecter
        </button>
      </form>
    </div>
  );
}
