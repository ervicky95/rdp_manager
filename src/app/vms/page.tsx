'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { api } from '@/lib/api';
import type { VM } from '@/types/vm';

type VMStatus = 'running' | 'stopped' | 'starting' | 'stopping';
type RDPSatus = 'healthy' | 'degraded' | 'unknown' | 'unreachable';

interface VMSummary {
  total: number;
  running: number;
  stopped: number;
  starting: number;
  stopping: number;
  rdpHealthy: number;
  rdpDegraded: number;
  rdpUnknown: number;
  rdpUnreachable: number;
}

export default function VmsPage() {
  const [vms, setVms] = useState<VM[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | VMStatus>('all');
  const [rdpFilter, setRdpFilter] = useState<'all' | RDPSatus>('all');
  const [sortBy, setSortBy] = useState<'name' | 'status' | 'last_seen' | 'cpu' | 'ram' | 'disk' | 'created_at'>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [busy, setBusy] = useState<string>('');

  const loadVMs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (rdpFilter !== 'all') params.set('rdp_status', rdpFilter);
      params.set('sort_by', sortBy);
      params.set('sort_order', sortOrder);
      params.set('limit', '100');

      const response = await api.get<{ vms: any[] }>(`/api/vms?${params.toString()}`);
      if (!response.ok) {
        throw response.error || new Error('Failed to load VMs');
      }

      // Transform API response (snake_case) to VM type (camelCase)
      const transformedVMs: VM[] = (response.data?.vms || []).map((apiVm: any) => ({
        id: apiVm.id,
        name: apiVm.name,
        ip: apiVm.ip_address,
        status: apiVm.status,
        os: apiVm.windows_version || 'Windows',
        agentVersion: apiVm.agent_version || 'unknown',
        lastSeen: apiVm.last_seen,
        rdpHealth: apiVm.rdp_status,
        cpu: apiVm.cpu_percent,
        ram: apiVm.ram_percent,
        disk: apiVm.disk_percent,
        createdAt: apiVm.created_at,
      }));
      setVms(transformedVMs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load VMs');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, rdpFilter, sortBy, sortOrder]);

  useEffect(() => {
    loadVMs();
  }, [loadVMs]);

  const filteredVMs = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return vms;
    return vms.filter((vm) =>
      vm.name.toLowerCase().includes(query) ||
      vm.ip.toLowerCase().includes(query)
    );
  }, [vms, search]);

  const summary = useMemo((): VMSummary => {
    return vms.reduce(
      (acc, vm) => {
        acc.total++;
        if (vm.status === 'running') acc.running++;
        else if (vm.status === 'stopped') acc.stopped++;
        else if (vm.status === 'starting') acc.starting++;
        else if (vm.status === 'stopping') acc.stopping++;

        if (vm.rdpHealth === 'healthy') acc.rdpHealthy++;
        else if (vm.rdpHealth === 'degraded') acc.rdpDegraded++;
        else if (vm.rdpHealth === 'unknown') acc.rdpUnknown++;
        else if (vm.rdpHealth === 'unreachable') acc.rdpUnreachable++;

        return acc;
      },
      {
        total: 0,
        running: 0,
        stopped: 0,
        starting: 0,
        stopping: 0,
        rdpHealthy: 0,
        rdpDegraded: 0,
        rdpUnknown: 0,
        rdpUnreachable: 0,
      }
    );
  }, [vms]);

  const running = vms.filter((vm) => vm.status === 'running').length;
  const stopped = vms.filter((vm) => vm.status === 'stopped').length;
  const stale = vms.filter((vm) => vm.status === 'running' && !vm.lastSeen).length;
  const healthy = vms.filter((vm) => vm.rdpHealth === 'healthy').length;

  function statusColor(status: string) {
    const value = status.toLowerCase();
    if (value === 'running' || value === 'online') return 'bg-green-500/15 text-green-400';
    if (value === 'starting' || value === 'stopping') return 'bg-yellow-500/15 text-yellow-400';
    return 'bg-red-500/15 text-red-400';
  }

  function rdpColor(status: string) {
    const value = status.toLowerCase();
    if (value === 'healthy') return 'bg-green-500/15 text-green-400';
    if (value === 'degraded') return 'bg-yellow-500/15 text-yellow-400';
    return 'bg-slate-500/20 text-slate-300';
  }

  function formatPercent(value: number): string {
    const clamped = Math.max(0, Math.min(100, value));
    return `${clamped.toFixed(1)}%`;
  }

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

  const sortOptions = [
    { value: 'name', label: 'Name' },
    { value: 'status', label: 'Status' },
    { value: 'last_seen', label: 'Last Seen' },
    { value: 'cpu', label: 'CPU %' },
    { value: 'ram', label: 'RAM %' },
    { value: 'disk', label: 'Disk %' },
  ] as const;

  async function handleAddVM(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !ipAddress.trim()) return;

    try {
      setBusy('add');
      const response = await api.post<{ vm: VM; enrollment_token: string; expires_at: string }>('/api/vms', {
        name: name.trim(),
        ip_address: ipAddress.trim(),
      });
      if (!response.ok) throw response.error || new Error('Failed to create VM');
      setShowAdd(false);
      setName('');
      setIpAddress('');
      await loadVMs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add VM');
    } finally {
      setBusy('');
    }
  }

  async function handleDelete(vm: VM) {
    if (!confirm(`Delete "${vm.name}" from RDP Manager? This removes only application records. It will not contact or modify the Windows VM.`)) return;
    if (!confirm(`Type the VM name "${vm.name}" to confirm deletion:`)) return;

    try {
      setBusy(`${vm.id}:delete`);
      const response = await api.delete<{ ok: boolean; deleted: boolean; id: string }>(`/api/vms/${vm.id}`);
      if (!response.ok) throw response.error || new Error('Failed to delete VM');
      await loadVMs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete VM');
    } finally {
      setBusy('');
    }
  }

  return (
    <main className="min-h-screen bg-surface-50 dark:bg-surface-950">
      <Header />
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-3xl font-bold">VMs</h1>
            <p className="mt-1 text-surface-400">Manage your Windows VM inventory</p>
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

        {/* Summary Cards */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-surface-400">Total VMs</p>
              <p className="mt-2 text-3xl font-bold">{summary.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-surface-400">Running</p>
              <p className="mt-2 text-3xl font-bold text-green-400">{summary.running}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-surface-400">Stopped</p>
              <p className="mt-2 text-3xl font-bold text-yellow-400">{summary.stopped}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-surface-400">RDP Healthy</p>
              <p className="mt-2 text-3xl font-bold text-cyan-400">{summary.rdpHealthy}</p>
            </CardContent>
          </Card>
        </div>

        {/* Search and Filters */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Input
            type="search"
            placeholder="Search by VM name or IP address..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full sm:w-80"
          />

          <div className="flex flex-wrap gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
            >
              <option value="all">All Status</option>
              <option value="running">Running</option>
              <option value="stopped">Stopped</option>
              <option value="starting">Starting</option>
              <option value="stopping">Stopping</option>
            </select>

            <select
              value={rdpFilter}
              onChange={(e) => setRdpFilter(e.target.value as any)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
            >
              <option value="all">All RDP</option>
              <option value="healthy">Healthy</option>
              <option value="degraded">Degraded</option>
              <option value="unknown">Unknown</option>
              <option value="unreachable">Unreachable</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
            >
              {sortOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="whitespace-nowrap"
            >
              {sortOrder === 'asc' ? '↑ Asc' : '↓ Desc'}
            </Button>
          </div>
        </div>

        {/* VM List */}
        {loading ? (
          <Card>
            <CardContent className="p-10 text-center text-surface-400">
              <div className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-6 w-6 text-primary-600" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Loading VMs...
              </div>
            </CardContent>
          </Card>
        ) : filteredVMs.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center">
              <p className="text-surface-400">No VMs found.</p>
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                className="mt-4 rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-slate-950"
              >
                Add your first VM
              </button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredVMs.map((vm) => (
              <Card key={vm.id}>
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/vms/${vm.id}`}
                        className="text-lg font-semibold text-cyan-300 hover:underline truncate block"
                      >
                        {vm.name}
                      </Link>
                      <p className="mt-1 text-sm text-surface-400 font-mono">{vm.ip}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <span className={`rounded-full px-3 py-1 ${statusColor(vm.status)}`}>
                          {vm.status}
                        </span>
                        <span className={`rounded-full px-3 py-1 ${rdpColor(vm.rdpHealth)}`}>
                          RDP: {vm.rdpHealth}
                        </span>
                        <span className="rounded-full bg-slate-800 px-3 py-1 text-slate-300">
                          Last seen: {formatLastSeen(vm.lastSeen)}
                        </span>
                        <span className="rounded-full bg-slate-800 px-3 py-1 text-slate-300">
                          Agent: {vm.agentVersion || 'Not enrolled'}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 sm:items-center">
                      <div className="grid grid-cols-3 gap-2 text-xs sm:grid-cols-4 hidden sm:grid">
                        <div>
                          <p className="text-surface-500">CPU</p>
                          <p className="mt-1 font-semibold">{formatPercent(vm.cpu)}</p>
                        </div>
                        <div>
                          <p className="text-surface-500">RAM</p>
                          <p className="mt-1 font-semibold">{formatPercent(vm.ram)}</p>
                        </div>
                        <div>
                          <p className="text-surface-500">Disk</p>
                          <p className="mt-1 font-semibold">{formatPercent(vm.disk)}</p>
                        </div>
                      </div>

                      <Link
                        href={`/vms/${vm.id}`}
                        className="rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800 whitespace-nowrap"
                      >
                        Details
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDelete(vm)}
                        disabled={busy !== ''}
                        className="rounded-lg border border-red-700 px-3 py-2 text-sm text-red-400 hover:bg-red-950/40 disabled:opacity-50 whitespace-nowrap"
                      >
                        {busy === `${vm.id}:delete` ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {showAdd && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
            <form onSubmit={handleAddVM} className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6">
              <h2 className="text-xl font-bold">Add VM</h2>
              <p className="mt-2 text-sm text-slate-400">
                After creation, an enrollment token will be shown and copied.
              </p>

              <label className="mt-5 block text-sm text-slate-300">
                VM name
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  className="mt-2 w-full"
                  placeholder="disposable-win-test-01"
                />
              </label>

              <label className="mt-4 block text-sm text-slate-300">
                Public IP address
                <Input
                  value={ipAddress}
                  onChange={(event) => setIpAddress(event.target.value)}
                  required
                  className="mt-2 w-full"
                  placeholder="203.0.113.10"
                />
              </label>

              <div className="mt-6 flex justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAdd(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={busy === 'add'}>
                  {busy === 'add' ? 'Creating...' : 'Create VM'}
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}