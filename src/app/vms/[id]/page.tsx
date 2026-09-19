'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
import type { VM } from '@/types/vm';

interface VMPageProps {
  params: Promise<{ id: string }>;
}

function formatTimestamp(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString();
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function getStatusColor(status: VM['status']): string {
  switch (status) {
    case 'running': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300';
    case 'stopped': return 'bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-300';
    case 'starting': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300';
    case 'stopping': return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300';
  }
}

function getRdpColor(rdp: VM['rdpHealth']): string {
  switch (rdp) {
    case 'healthy': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300';
    case 'degraded': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300';
    case 'unknown': return 'bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-300';
    case 'unreachable': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
  }
}

function VMContent({ id }: { id: string }) {
  const [vm, setVm] = useState<VM | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchVM = useCallback(async () => {
    try {
      const res = await fetch(`/api/vms/${id}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error('VM not found');
        throw new Error('Failed to fetch VM');
      }
      const data = await res.json();
      const apiVm = data.vm;
      setVm({
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
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load VM');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchVM();
    const interval = setInterval(fetchVM, 15000);
    return () => clearInterval(interval);
  }, [fetchVM]);

  const handleAction = async (action: 'restart' | 'shutdown' | 'status' | 'rdp_check') => {
    if (!vm) return;
    setActionLoading(action);
    try {
      const res = await fetch(`/api/vms/${id}/${action}`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Failed to ${action}`);
      }
      await fetchVM();
    } catch (err) {
      alert(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!vm || !confirm('Are you sure you want to delete this VM record? This does not affect the actual VM.')) return;
    try {
      const res = await fetch(`/api/vms/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete VM');
      }
      window.location.href = '/dashboard';
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete VM');
    }
  };

  if (loading && !vm) {
    return (
      <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center justify-center">
            <svg className="animate-spin h-8 w-8 text-primary-600" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        </main>
      </div>
    );
  }

  if (error || !vm) {
    return (
      <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-50">VM Not Found</h1>
            <p className="mt-2 text-surface-500 dark:text-surface-400">{error || 'The requested VM does not exist.'}</p>
            <Link href="/dashboard" className="mt-4 inline-block text-primary-600 hover:text-primary-700">
              ← Back to Dashboard
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const isActionDisabled = actionLoading !== null || !['running', 'starting', 'stopping'].includes(vm.status);

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="animate-in">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div>
              <Link
                href="/dashboard"
                className="text-sm text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200"
              >
                ← Dashboard
              </Link>
              <h1 className="mt-1 text-2xl sm:text-3xl font-bold text-surface-900 dark:text-surface-50 tracking-tight">
                {vm.name}
              </h1>
              <p className="mt-1 text-sm text-surface-500 dark:text-surface-400 font-mono">{vm.ip}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={fetchVM} disabled={loading}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={handleDelete}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete
              </Button>
            </div>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm" role="alert">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardContent className="p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-4 h-4 rounded-full ${vm.status === 'running' ? 'bg-green-500' : vm.status === 'stopped' ? 'bg-surface-400' : vm.status === 'starting' ? 'bg-yellow-500' : 'bg-orange-500'}`} aria-hidden="true" />
                      <div>
                        <p className="text-lg font-semibold text-surface-900 dark:text-surface-50">{vm.name}</p>
                        <p className="text-sm text-surface-500 dark:text-surface-400 font-mono">{vm.ip}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <Badge className={getStatusColor(vm.status)} variant="outline" >
                        {vm.status.charAt(0).toUpperCase() + vm.status.slice(1)}
                      </Badge>
                      <Badge className={getRdpColor(vm.rdpHealth)} variant="outline" >
                        RDP: {vm.rdpHealth.charAt(0).toUpperCase() + vm.rdpHealth.slice(1)}
                      </Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                    <div>
                      <p className="text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">CPU</p>
                      <p className="mt-1 text-2xl font-mono font-semibold text-surface-900 dark:text-surface-50">{vm.cpu}%</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">RAM</p>
                      <p className="mt-1 text-2xl font-mono font-semibold text-surface-900 dark:text-surface-50">{vm.ram}%</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">Disk</p>
                      <p className="mt-1 text-2xl font-mono font-semibold text-surface-900 dark:text-surface-50">{vm.disk}%</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">Uptime</p>
                      <p className="mt-1 text-lg font-mono font-semibold text-surface-900 dark:text-surface-50">
                        {vm.status === 'running' ? '—' : 'N/A'}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => handleAction('restart')}
                      disabled={isActionDisabled}
                      isLoading={actionLoading === 'restart'}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Restart
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => handleAction('shutdown')}
                      disabled={isActionDisabled}
                      isLoading={actionLoading === 'shutdown'}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14v6m-3-3h6M6 10h2a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2zm10 0h2a2 2 0 002-2V6a2 2 0 00-2-2h-2a2 2 0 00-2 2v2a2 2 0 002 2zM6 20h.01M17 20h.01" />
                      </svg>
                      Shutdown
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleAction('status')}
                      disabled={isActionDisabled}
                      isLoading={actionLoading === 'status'}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      Get Status
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleAction('rdp_check')}
                      disabled={isActionDisabled}
                      isLoading={actionLoading === 'rdp_check'}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      Check RDP
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50 mb-4">Details</h2>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <div>
                      <dt className="text-surface-500 dark:text-surface-400">OS</dt>
                      <dd className="mt-1 font-medium text-surface-900 dark:text-surface-50">{vm.os}</dd>
                    </div>
                    <div>
                      <dt className="text-surface-500 dark:text-surface-400">Agent Version</dt>
                      <dd className="mt-1 font-medium text-surface-900 dark:text-surface-50 font-mono">{vm.agentVersion}</dd>
                    </div>
                    <div>
                      <dt className="text-surface-500 dark:text-surface-400">Last Seen</dt>
                      <dd className="mt-1 font-medium text-surface-900 dark:text-surface-50">{formatTimestamp(vm.lastSeen)}</dd>
                    </div>
                    <div>
                      <dt className="text-surface-500 dark:text-surface-400">Created</dt>
                      <dd className="mt-1 font-medium text-surface-900 dark:text-surface-50">{formatTimestamp(vm.createdAt)}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-surface-500 dark:text-surface-400">Quick Links</dt>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Link href={`/vms/${vm.id}/logs`} className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 text-sm underline">
                          View Text Logs
                        </Link>
                        <Link href={`/vms/${vm.id}/commands`} className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 text-sm underline">
                          Command History
                        </Link>
                        <Link href={`/vms/${vm.id}/settings`} className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 text-sm underline">
                          Settings
                        </Link>
                      </div>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardContent className="p-6">
                  <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50 mb-4">Actions</h2>
                  <div className="space-y-2">
                    <Link href={`/vms/${vm.id}/logs`}>
                      <Button variant="ghost" className="w-full justify-start" disabled={loading}>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        View Text Logs (INFO/WARN/ERROR)
                      </Button>
                    </Link>
                    <Link href={`/vms/${vm.id}/commands`}>
                      <Button variant="ghost" className="w-full justify-start" disabled={loading}>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                        </svg>
                        Command History
                      </Button>
                    </Link>
                    <Link href={`/vms/${vm.id}/settings`}>
                      <Button variant="ghost" className="w-full justify-start" disabled={loading}>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 001.066-2.573c-.94-1.543.826 3.31-2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Settings
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-surface-200 dark:border-surface-800 py-6 px-4 sm:px-6 lg:px-8 mt-12">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-surface-500 dark:text-surface-400">
          <p>RDP Manager v0.1.0 — Personal VM Management</p>
          <p className="font-mono text-xs">Next.js 14 • Tailwind CSS • Cloudflare Workers</p>
        </div>
      </footer>
    </div>
  );
}

export default function VMPage({ params }: VMPageProps) {
  const [resolvedId, setResolvedId] = useState<string | null>(null);

  useEffect(() => {
    params.then(p => setResolvedId(p.id));
  }, [params]);

  if (!resolvedId) {
    return (
      <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center justify-center">
            <svg className="animate-spin h-8 w-8 text-primary-600" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        </main>
      </div>
    );
  }

  return <VMContent id={resolvedId} />;
}