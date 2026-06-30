import { useEffect, useState } from "react";

type Health = { ok: boolean; app: string; phase: number; ts: string };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json<Health>())
      .then(setHealth)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <main className="min-h-dvh flex items-center justify-center bg-slate-950 text-slate-100">
      <div className="text-center space-y-3">
        <div className="text-5xl">☑</div>
        <h1 className="text-2xl font-semibold tracking-tight">Checkbox</h1>
        <p className="text-slate-400 text-sm">Phase 0 scaffold is live.</p>
        <p className="text-xs text-slate-500">
          API:{" "}
          {error
            ? `error: ${error}`
            : health
              ? `ok (phase ${health.phase})`
              : "checking..."}
        </p>
      </div>
    </main>
  );
}
