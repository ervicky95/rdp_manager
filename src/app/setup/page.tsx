'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';

type CreatedAdmin = {
  email: string;
  password: string;
};

export default function SetupPage() {
  const [email, setEmail] = useState('');
  const [bootstrapSecret, setBootstrapSecret] = useState('');
  const [createdAdmin, setCreatedAdmin] = useState<CreatedAdmin | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setCreatedAdmin(null);
    setCopied(false);
    setLoading(true);

    try {
      const response = await fetch('/api/auth/bootstrap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          bootstrapSecret,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Administrator setup failed');
        return;
      }

      setCreatedAdmin({
        email: data.email,
        password: data.password,
      });

      setBootstrapSecret('');
    } catch {
      setError('Could not connect to the application');
    } finally {
      setLoading(false);
    }
  }

  async function copyPassword() {
    if (!createdAdmin) return;

    await navigator.clipboard.writeText(createdAdmin.password);
    setCopied(true);
  }

  if (createdAdmin) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-12 text-white">
        <section className="mx-auto max-w-lg rounded-2xl border border-slate-700 bg-slate-800 p-8 shadow-xl">
          <h1 className="text-2xl font-bold text-green-400">
            Administrator created
          </h1>

          <p className="mt-3 text-slate-300">
            Save this password now. It is generated once and will not be shown
            again.
          </p>

          <div className="mt-6 rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Email</p>
            <p className="mt-1 break-all font-medium">{createdAdmin.email}</p>

            <p className="mt-5 text-sm text-slate-400">Generated password</p>
            <p className="mt-1 break-all rounded bg-slate-950 p-3 font-mono text-sm text-cyan-300">
              {createdAdmin.password}
            </p>
          </div>

          <button
            type="button"
            onClick={copyPassword}
            className="mt-5 w-full rounded-lg bg-cyan-500 px-4 py-3 font-semibold text-slate-950 hover:bg-cyan-400"
          >
            {copied ? 'Password copied' : 'Copy password'}
          </button>

          <Link
            href="/login"
            className="mt-4 block text-center text-cyan-300 hover:text-cyan-200"
          >
            Continue to normal login
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-12 text-white">
      <section className="mx-auto max-w-lg rounded-2xl border border-slate-700 bg-slate-800 p-8 shadow-xl">
        <h1 className="text-2xl font-bold">First administrator setup</h1>

        <p className="mt-3 text-slate-300">
          Use the temporary bootstrap secret to create the first administrator.
          The application will generate the administrator password for you.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-5">
          <div>
            <label htmlFor="email" className="block text-sm text-slate-300">
              Administrator email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-900 px-4 py-3 text-white outline-none focus:border-cyan-400"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label
              htmlFor="bootstrapSecret"
              className="block text-sm text-slate-300"
            >
              Bootstrap secret
            </label>
            <input
              id="bootstrapSecret"
              type="password"
              required
              autoComplete="off"
              value={bootstrapSecret}
              onChange={(event) => setBootstrapSecret(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-900 px-4 py-3 text-white outline-none focus:border-cyan-400"
              placeholder="Enter the Wrangler bootstrap secret"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-950/40 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-cyan-500 px-4 py-3 font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Creating administrator...' : 'Create administrator'}
          </button>
        </form>

        <Link
          href="/login"
          className="mt-6 block text-center text-sm text-slate-400 hover:text-white"
        >
          Back to login
        </Link>
      </section>
    </main>
  );
}
