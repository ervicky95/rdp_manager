'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';

type VM = {
  id: string;
  name: string;
  ip_address: string;
  status: string;
  agent_id: string | null;
  agent_version: string | null;
  windows_version: string | null;
  cpu_percent: number;
  ram_percent: number;
  disk_percent: number;
  rdp_status: string;
  uptime_seconds: number;
  last_seen: string | null;
  created_at: string;
};

type TokenInfo = {
  vmName: string;
  token: string;
  expiresAt: string;
};

function formatLastSeen(value: string | null) {
  if (!value) return 'Never';

  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return value;

  const minutes = Math.floor((Date.now() - time) / 60000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

function statusColor(status: string) {
  const value = status.toLowerCase();

  if (value === 'running' || value === 'online') {
    return 'bg-green-500/15 text-green-400';
  }

  if (value === 'starting' || value === 'stopping') {
    return 'bg-yellow-500/15 text-yellow-400';
  }

  return 'bg-red-500/15 text-red-400';
}

function rdpColor(status: string) {
  const value = status.toLowerCase();

  if (value === 'healthy') {
    return 'bg-green-500/15 text-green-400';
  }

  if (value === 'degraded') {
    return 'bg-yellow-500/15 text-yellow-400';
  }

  return 'bg-slate-500/20 text-slate-300';
}

export default function DashboardPage() {
  const [vms, setVms] = useState<VM[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  async function loadVMs() {
    try {
      setLoading(true);
      setError('');

      const response = await fetch('/api/vms?limit=100', {
        cache: 'no-store',
      });

      if (response.status === 401) {
        window.location.href = '/login?redirect=/dashboard';
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load VMs');
      }

      setVms(Array.isArray(data.vms) ? data.vms : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load VMs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadVMs();
  }, []);

  const filteredVMs = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return vms;

    return vms.filter((vm) =>
      vm.name.toLowerCase().includes(query) ||
      vm.ip_address.toLowerCase().includes(query)
    );
  }, [vms, search]);

  const running = vms.filter((vm) => vm.status === 'running').length;
  const stopped = vms.filter((vm) => vm.status === 'stopped').length;
  const healthy = vms.filter((vm) => vm.rdp_status === 'healthy').length;

  async function performAction(
    vm: VM,
    action: 'status' | 'rdp-check' | 'restart' | 'shutdown'
  ) {
    const key = `${vm.id}:${action}`;

    if (action === 'restart' || action === 'shutdown') {
      const confirmed = window.confirm(
        action === 'restart'
          ? `Restart Windows on "${vm.name}"?`
          : `Shut down Windows on "${vm.name}"?`
      );

      if (!confirmed) return;
    }

    try {
      setBusy(key);
      setError('');

      const response = await fetch(`/api/vms/${vm.id}/${action}`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Failed to ${action}`);
      }

      await loadVMs();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setBusy('');
    }
  }

  async function deleteVM(vm: VM) {
    const confirmed = window.confirm(
      `Delete "${vm.name}" from RDP Manager? This removes only application records. It will not contact or modify the Windows VM.`
    );

    if (!confirmed) return;

    try {
      setBusy(`${vm.id}:delete`);
      setError('');

      const response = await fetch(`/api/vms/${vm.id}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete VM');
      }

      await loadVMs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete VM');
    } finally {
      setBusy('');
    }
  }

  async function createVM(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!name.trim() || !ipAddress.trim()) {
      setError('VM name and IP address are required');
      return;
    }

    try {
      setBusy('add');
      setError('');

      const response = await fetch('/api/vms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: name.trim(),
          ip_address: ipAddress.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to add VM');
      }

      setShowAdd(false);
      setName('');
      setIpAddress('');

      if (data.enrollment_token) {
        setTokenInfo({
          vmName: data.vm?.name || name.trim(),
          token: data.enrollment_token,
          expiresAt: data.expires_at,
        });
        setTokenCopied(false);
      }

      await loadVMs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add VM');
    } finally {
      setBusy('');
    }
  }

  async function generateToken(vm: VM) {
    try {
      setBusy(`${vm.id}:token`);
      setError('');

      const response = await fetch(
        `/api/vms/${vm.id}/enrollment-token`,
        {
          method: 'POST',
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate enrollment token');
      }

      setTokenInfo({
        vmName: vm.name,
        token: data.enrollment_token,
        expiresAt: data.expires_at,
      });
      setTokenCopied(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to generate enrollment token'
      );
    } finally {
      setBusy('');
    }
  }

  async function copyToken() {
    if (!tokenInfo) return;

    try {
      await navigator.clipboard.writeText(tokenInfo.token);
      setTokenCopied(true);
    } catch {
      window.prompt(
        'Copy this enrollment token:',
        tokenInfo.token
      );
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5">
          <Link href="/dashboard" className="text-xl font-bold">
            <span className="text-cyan-400">◆</span> RDP Manager
          </Link>

          <nav className="flex items-center gap-5 text-sm">
            <Link href="/dashboard" className="text-cyan-300">
              Dashboard
            </Link>
            <Link href="/vms" className="text-slate-300 hover:text-white">
              VMs
            </Link>
            <button
              type="button"
              onClick={logout}
              className="border-l border-slate-700 pl-5 text-slate-300 hover:text-white"
            >
              Admin / Logout
            </button>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <p className="mt-1 text-slate-400">
              Manage your Windows VMs
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="rounded-lg bg-cyan-500 px-5 py-3 font-semibold text-slate-950 hover:bg-cyan-400"
          >
            + Add VM
          </button>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-800 bg-red-950/40 p-4 text-red-300">
            {error}
          </div>
        )}

        <div className="mb-8 grid gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
            <p className="text-sm text-slate-400">Total VMs</p>
            <p className="mt-2 text-3xl font-bold">{vms.length}</p>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
            <p className="text-sm text-slate-400">Running</p>
            <p className="mt-2 text-3xl font-bold text-green-400">
              {running}
            </p>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
            <p className="text-sm text-slate-400">Stopped</p>
            <p className="mt-2 text-3xl font-bold text-yellow-400">
              {stopped}
            </p>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
            <p className="text-sm text-slate-400">RDP Healthy</p>
            <p className="mt-2 text-3xl font-bold text-cyan-400">
              {healthy}
            </p>
          </div>
        </div>

        <div className="mb-6">
          <input
            type="search"
            placeholder="Search by VM name or IP address..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-white outline-none focus:border-cyan-400"
          />
        </div>

        {loading ? (
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-10 text-center text-slate-400">
            Loading VMs...
          </div>
        ) : filteredVMs.length === 0 ? (
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-10 text-center">
            <p className="text-slate-400">No VMs found.</p>
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="mt-4 rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-slate-950"
            >
              Add your first VM
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {filteredVMs.map((vm) => (
              <section
                key={vm.id}
                className="rounded-xl border border-slate-700 bg-slate-900 p-5"
              >
                <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
                  <div className="min-w-0">
                    <Link
                      href={`/vms/${vm.id}`}
                      className="text-xl font-semibold text-cyan-300 hover:underline"
                    >
                      {vm.name}
                    </Link>

                    <p className="mt-1 text-slate-400">
                      {vm.ip_address}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <span className={`rounded-full px-3 py-1 ${statusColor(vm.status)}`}>
                        {vm.status}
                      </span>

                      <span className={`rounded-full px-3 py-1 ${rdpColor(vm.rdp_status)}`}>
                        RDP: {vm.rdp_status}
                      </span>

                      <span className="rounded-full bg-slate-800 px-3 py-1 text-slate-300">
                        Last seen: {formatLastSeen(vm.last_seen)}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:flex xl:flex-wrap">
                    <button
                      type="button"
                      onClick={() => performAction(vm, 'status')}
                      disabled={busy !== ''}
                      className="rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
                    >
                      {busy === `${vm.id}:status` ? 'Working...' : 'Status'}
                    </button>

                    <button
                      type="button"
                      onClick={() => performAction(vm, 'rdp-check')}
                      disabled={busy !== ''}
                      className="rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
                    >
                      {busy === `${vm.id}:rdp-check` ? 'Working...' : 'RDP Check'}
                    </button>

                    <button
                      type="button"
                      onClick={() => performAction(vm, 'restart')}
                      disabled={busy !== ''}
                      className="rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
                    >
                      Restart
                    </button>

                    <button
                      type="button"
                      onClick={() => performAction(vm, 'shutdown')}
                      disabled={busy !== ''}
                      className="rounded-lg border border-yellow-700 px-3 py-2 text-sm text-yellow-300 hover:bg-yellow-950/40 disabled:opacity-50"
                    >
                      Shutdown
                    </button>

                    <Link
                      href={`/vms/${vm.id}/settings`}
                      className="rounded-lg border border-slate-600 px-3 py-2 text-center text-sm hover:bg-slate-800"
                    >
                      Settings
                    </Link>

                    <button
                      type="button"
                      onClick={() => generateToken(vm)}
                      disabled={busy !== ''}
                      className="rounded-lg border border-cyan-700 px-3 py-2 text-sm text-cyan-300 hover:bg-cyan-950/40 disabled:opacity-50"
                    >
                      {busy === `${vm.id}:token` ? 'Working...' : 'Enrollment token'}
                    </button>

                    <button
                      type="button"
                      onClick={() => deleteVM(vm)}
                      disabled={busy !== ''}
                      className="rounded-lg border border-red-700 px-3 py-2 text-sm text-red-400 hover:bg-red-950/40 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 border-t border-slate-800 pt-4 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-slate-500">CPU</p>
                    <p className="mt-1 font-semibold">{vm.cpu_percent}%</p>
                  </div>
                  <div>
                    <p className="text-slate-500">RAM</p>
                    <p className="mt-1 font-semibold">{vm.ram_percent}%</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Disk</p>
                    <p className="mt-1 font-semibold">{vm.disk_percent}%</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Agent</p>
                    <p className="mt-1 font-semibold">
                      {vm.agent_version || 'Not enrolled'}
                    </p>
                  </div>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <form
            onSubmit={createVM}
            className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6"
          >
            <h2 className="text-xl font-bold">Add VM</h2>
            <p className="mt-2 text-sm text-slate-400">
              After creation, an enrollment token will be shown and copied.
            </p>

            <label className="mt-5 block text-sm text-slate-300">
              VM name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 outline-none focus:border-cyan-400"
                placeholder="disposable-win-test-01"
              />
            </label>

            <label className="mt-4 block text-sm text-slate-300">
              Public IP address
              <input
                value={ipAddress}
                onChange={(event) => setIpAddress(event.target.value)}
                required
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 outline-none focus:border-cyan-400"
                placeholder="203.0.113.10"
              />
            </label>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={busy === 'add'}
                className="rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
              >
                {busy === 'add' ? 'Creating...' : 'Create VM'}
              </button>
            </div>
          </form>
        </div>
      )}

      {tokenInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6">
            <h2 className="text-xl font-bold">Enrollment token</h2>

            <p className="mt-2 text-sm text-slate-400">
              VM: {tokenInfo.vmName}
            </p>

            <textarea
              value={tokenInfo.token}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
              className="mt-5 h-28 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-sm text-cyan-300 outline-none"
            />

            <p className="mt-2 text-xs text-yellow-300">
              Expires: {tokenInfo.expiresAt}
            </p>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={copyToken}
                className="rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-slate-950"
              >
                {tokenCopied ? 'Copied' : 'Copy token'}
              </button>

              <button
                type="button"
                onClick={() => setTokenInfo(null)}
                className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
