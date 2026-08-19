import { useState, type FormEvent } from 'react';
import { User, KeyRound, ArrowRight } from 'lucide-react';
import { useAuth } from '@/lib/auth';

export function LoginPage() {
  const { login } = useAuth();
  const [empId, setEmpId] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(empId.trim(), loginCode.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'You do not have access to this system.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-teal-600/20 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-80 w-80 translate-x-1/3 translate-y-1/3 rounded-full bg-sky-600/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <img src="/Screenshot_2026-07-15_102148.png" alt="BAK Mantech" className="mx-auto mb-4 h-20 w-auto object-contain" />
          <h1 className="text-2xl font-bold tracking-tight text-white">BAK Attendance V3</h1>
          <p className="mt-1 text-sm text-slate-400">Admin Portal</p>
        </div>

        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/60 p-8 shadow-2xl backdrop-blur">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="empId" className="mb-2 block text-sm font-medium text-slate-200">
                Employee ID
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  id="empId"
                  type="text"
                  value={empId}
                  autoFocus
                  autoCapitalize="characters"
                  autoCorrect="off"
                  onChange={(e) => setEmpId(e.target.value)}
                  placeholder="e.g. E1005"
                  className="w-full rounded-lg border border-slate-600 bg-slate-900/50 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-slate-500 transition focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
                />
              </div>
            </div>

            <div>
              <label htmlFor="loginCode" className="mb-2 block text-sm font-medium text-slate-200">
                5-Letter Code
              </label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  id="loginCode"
                  type="password"
                  value={loginCode}
                  maxLength={5}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  onChange={(e) => setLoginCode(e.target.value)}
                  placeholder="Your code"
                  className="w-full rounded-lg border border-slate-600 bg-slate-900/50 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-slate-500 transition focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
                />
              </div>
            </div>

            {error && (
              <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300 ring-1 ring-inset ring-rose-500/20">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !empId.trim() || !loginCode.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Signing in…' : 'Sign In'}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          BAK Attendance V3 · Authorized personnel only
        </p>
      </div>
    </div>
  );
}
