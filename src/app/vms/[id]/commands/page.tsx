'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
import type { Command } from '@/types/vm';

interface CommandsPageProps {
  params: Promise<{ id: string }>;
}

function formatTimestamp(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString();
}

function getStatusColor(status: Command['status']): string {
  switch (status) {
    case 'completed': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300';
    case 'failed': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
    case 'executing': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300';
    case 'pending': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
    case 'expired': return 'bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-300';
  }
}

function getCommandIcon(command: Command['command']): React.ReactNode {
  switch (command) {
    case 'restart':
      return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>;
    case 'shutdown':
      return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14v6m-3-3h6M6 10h2a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2zm10 0h2a2 2 0 002-2V6a2 2 0 00-2-2h-2a2 2 0 00-2 2v2a2 2 0 002 2zM6 20h.01M17 20h.01" /></svg>;
    case 'status':
      return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>;
    case 'rdp_check':
      return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>;
  }
}

function CommandsContent({ id }: { id: string }) {
  const [vmName, setVmName] = useState('VM');
  const [commands, setCommands] = useState<Command[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [vmRes, cmdRes] = await Promise.all([
        fetch(`/api/vms/${id}`),
        fetch(`/api/vms/${id}/commands?limit=200`),
      ]);

      if (!vmRes.ok) throw new Error('Failed to fetch VM');
      const vmData = await vmRes.json();
      setVmName(vmData.vm.name);

      if (!cmdRes.ok) throw new Error('Failed to fetch commands');
      const cmdData = await cmdRes.json();
      setCommands(cmdData.commands || []);

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load commands');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const filteredCommands = commands.filter((cmd) => statusFilter === 'all' || cmd.status === statusFilter);

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
                Command History: {vmName}
              </h1>
            </div>
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </Button>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm" role="alert">
              {error}
            </div>
          )}

          <Card>
            <CardContent className="p-4">
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    statusFilter === 'all'
                      ? 'bg-primary-600 text-white'
                      : 'bg-surface-100 text-surface-700 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300 dark:hover:bg-surface-700'
                  }`}
                >
                  All ({commands.length})
                </button>
                <button
                  onClick={() => setStatusFilter('pending')}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    statusFilter === 'pending'
                      ? 'bg-blue-600 text-white'
                      : 'bg-surface-100 text-surface-700 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300 dark:hover:bg-surface-700'
                  }`}
                >
                  Pending ({commands.filter(c => c.status === 'pending').length})
                </button>
                <button
                  onClick={() => setStatusFilter('executing')}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    statusFilter === 'executing'
                      ? 'bg-yellow-600 text-white'
                      : 'bg-surface-100 text-surface-700 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300 dark:hover:bg-surface-700'
                  }`}
                >
                  Executing ({commands.filter(c => c.status === 'executing').length})
                </button>
                <button
                  onClick={() => setStatusFilter('completed')}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    statusFilter === 'completed'
                      ? 'bg-green-600 text-white'
                      : 'bg-surface-100 text-surface-700 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300 dark:hover:bg-surface-700'
                  }`}
                >
                  Completed ({commands.filter(c => c.status === 'completed').length})
                </button>
                <button
                  onClick={() => setStatusFilter('failed')}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    statusFilter === 'failed'
                      ? 'bg-red-600 text-white'
                      : 'bg-surface-100 text-surface-700 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300 dark:hover:bg-surface-700'
                  }`}
                >
                  Failed ({commands.filter(c => c.status === 'failed').length})
                </button>
                <button
                  onClick={() => setStatusFilter('expired')}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    statusFilter === 'expired'
                      ? 'bg-surface-600 text-white'
                      : 'bg-surface-100 text-surface-700 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300 dark:hover:bg-surface-700'
                  }`}
                >
                  Expired ({commands.filter(c => c.status === 'expired').length})
                </button>
              </div>

              {loading && filteredCommands.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <svg className="animate-spin h-8 w-8 text-primary-600" viewBox="0 0 24 24" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                </div>
              ) : filteredCommands.length === 0 ? (
                <div className="p-8 text-center text-surface-500 dark:text-surface-400">
                  No commands found matching the current filter.
                </div>
              ) : (
                <div className="divide-y divide-surface-200 dark:divide-surface-700">
                  {filteredCommands.map((cmd) => (
                    <div key={cmd.id} className="p-4 hover:bg-surface-50 dark:hover:bg-surface-900/50">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                        <div className="flex items-center gap-3">
                          <span className="p-2 bg-surface-100 dark:bg-surface-800 rounded-lg text-surface-600 dark:text-surface-400">
                            {getCommandIcon(cmd.command)}
                          </span>
                          <div>
                            <p className="font-medium text-surface-900 dark:text-surface-100 capitalize">{cmd.command.replace('_', ' ')}</p>
                            <p className="text-xs text-surface-500 dark:text-surface-400 font-mono">ID: {cmd.id.slice(0, 8)}...</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                          <Badge className={getStatusColor(cmd.status)} variant="outline">
                            {cmd.status.charAt(0).toUpperCase() + cmd.status.slice(1)}
                          </Badge>
                          <time className="text-xs text-surface-500 dark:text-surface-400 font-mono whitespace-nowrap" dateTime={cmd.createdAt}>
                            Created: {formatTimestamp(cmd.createdAt)}
                          </time>
                          {cmd.acknowledgedAt && (
                            <time className="text-xs text-surface-500 dark:text-surface-400 font-mono whitespace-nowrap" dateTime={cmd.acknowledgedAt}>
                              Ack: {formatTimestamp(cmd.acknowledgedAt)}
                            </time>
                          )}
                          {cmd.executedAt && (
                            <time className="text-xs text-surface-500 dark:text-surface-400 font-mono whitespace-nowrap" dateTime={cmd.executedAt}>
                              Done: {formatTimestamp(cmd.executedAt)}
                            </time>
                          )}
                        </div>
                        {cmd.result && (
                          <div className="mt-2 p-3 bg-surface-100 dark:bg-surface-800 rounded text-sm text-surface-600 dark:text-surface-300 font-mono break-all max-h-32 overflow-auto">
                            {cmd.result}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
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

export default function CommandsPage({ params }: CommandsPageProps) {
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

  return <CommandsContent id={resolvedId} />;
}