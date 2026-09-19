'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
import type { LogEntry, AuditLog } from '@/types/vm';

interface LogsPageProps {
  params: Promise<{ id: string }>;
}

function formatTimestamp(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString();
}

function getLevelColor(level: LogEntry['level']): string {
  switch (level) {
    case 'error': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
    case 'warn': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300';
    case 'info': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
    case 'debug': return 'bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-300';
  }
}

function getSeverityColor(severity: AuditLog['severity']): string {
  switch (severity) {
    case 'error': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
    case 'warn': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300';
    case 'info': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
  }
}

function formatEventType(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

function LogsContent({ id }: { id: string }) {
  const [vmName, setVmName] = useState('VM');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [activeTab, setActiveTab] = useState<'text' | 'audit'>('text');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logLevelFilter, setLogLevelFilter] = useState<string>('all');
  const [auditSeverityFilter, setAuditSeverityFilter] = useState<string>('all');
  const [auditEventTypeFilter, setAuditEventTypeFilter] = useState<string>('all');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [vmRes, logsRes, auditRes] = await Promise.all([
        fetch(`/api/vms/${id}`),
        fetch(`/api/vms/${id}/logs?limit=200${logLevelFilter !== 'all' ? `&level=${logLevelFilter}` : ''}`),
        fetch(`/api/vms/${id}/audit-logs?limit=200${auditSeverityFilter !== 'all' ? `&severity=${auditSeverityFilter}` : ''}${auditEventTypeFilter !== 'all' ? `&event_type=${auditEventTypeFilter}` : ''}`),
      ]);

      if (!vmRes.ok) throw new Error('Failed to fetch VM');
      const vmData = await vmRes.json();
      setVmName(vmData.vm.name);

      if (!logsRes.ok) throw new Error('Failed to fetch logs');
      const logsData = await logsRes.json();
      setLogs(logsData.logs || []);

      if (!auditRes.ok) throw new Error('Failed to fetch audit logs');
      const auditData = await auditRes.json();
      setAuditLogs(auditData.logs || []);

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, [id, logLevelFilter, auditSeverityFilter, auditEventTypeFilter]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

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
                Logs: {vmName}
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

          <div className="border-b border-surface-200 dark:border-surface-700 mb-6">
            <nav className="flex gap-4" aria-label="Log types">
              <button
                onClick={() => setActiveTab('text')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'text'
                    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200'
                }`}
              >
                Text Logs ({logs.length})
              </button>
              <button
                onClick={() => setActiveTab('audit')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'audit'
                    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200'
                }`}
              >
                Audit Events ({auditLogs.length})
              </button>
            </nav>
          </div>

          {activeTab === 'text' && (
            <Card>
              <CardContent className="p-4">
                {/* Log Level Filter */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {['all', ...LOG_LEVELS].map((level) => (
                    <button
                      key={level}
                      onClick={() => setLogLevelFilter(level)}
                      className={`px-3 py-1.5 text-sm font-medium rounded-full transition-colors ${
                        logLevelFilter === level
                          ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                          : 'bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700'
                      }`}
                    >
                      {level.toUpperCase()}
                    </button>
                  ))}
                </div>

                {loading && logs.length === 0 ? (
                  <div className="flex items-center justify-center py-12">
                    <svg className="animate-spin h-8 w-8 text-primary-600" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  </div>
                ) : logs.length === 0 ? (
                  <div className="p-8 text-center text-surface-500 dark:text-surface-400">
                    No text logs found for this VM.
                  </div>
                ) : (
                  <div className="divide-y divide-surface-200 dark:divide-surface-700 max-h-[60vh] overflow-y-auto">
                    {logs.map((log) => (
                      <div key={log.id} className="p-4 hover:bg-surface-50 dark:hover:bg-surface-900/50">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                          <Badge className={getLevelColor(log.level)} variant="outline">
                            {log.level.toUpperCase()}
                          </Badge>
                          <time className="text-xs text-surface-500 dark:text-surface-400 font-mono whitespace-nowrap" dateTime={log.timestamp}>
                            {formatTimestamp(log.timestamp)}
                          </time>
                          <p className="flex-1 text-surface-900 dark:text-surface-100 font-mono text-sm break-all">{log.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {activeTab === 'audit' && (
            <Card>
              <CardContent className="p-4">
                {/* Audit Filters */}
                <div className="flex flex-wrap gap-2 mb-4">
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-surface-500 dark:text-surface-400">Severity:</label>
                    <select
                      value={auditSeverityFilter}
                      onChange={(e) => setAuditSeverityFilter(e.target.value)}
                      className="input text-sm py-1.5 max-w-xs"
                    >
                      <option value="all">All</option>
                      <option value="info">Info</option>
                      <option value="warn">Warn</option>
                      <option value="error">Error</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-surface-500 dark:text-surface-400">Event Type:</label>
                    <select
                      value={auditEventTypeFilter}
                      onChange={(e) => setAuditEventTypeFilter(e.target.value)}
                      className="input text-sm py-1.5 max-w-xs"
                    >
                      <option value="all">All</option>
                      <option value="vm_created">VM Created</option>
                      <option value="vm_deleted">VM Deleted</option>
                      <option value="vm_updated">VM Updated</option>
                      <option value="command_restart">Command Restart</option>
                      <option value="command_shutdown">Command Shutdown</option>
                      <option value="command_status">Command Status</option>
                      <option value="command_rdp_check">Command RDP Check</option>
                      <option value="command_completed">Command Completed</option>
                      <option value="command_failed">Command Failed</option>
                      <option value="command_expired">Command Expired</option>
                      <option value="command_acknowledged">Command Acknowledged</option>
                      <option value="rdp_recovery_triggered">RDP Recovery Triggered</option>
                      <option value="rdp_recovery_completed">RDP Recovery Completed</option>
                      <option value="rdp_recovery_failed">RDP Recovery Failed</option>
                      <option value="agent_enrolled">Agent Enrolled</option>
                      <option value="agent_reenrolled">Agent Re-enrolled</option>
                      <option value="agent_disconnected">Agent Disconnected</option>
                      <option value="settings_updated">Settings Updated</option>
                      <option value="enrollment_token_created">Enrollment Token Created</option>
                    </select>
                  </div>
                </div>

                {loading && auditLogs.length === 0 ? (
                  <div className="flex items-center justify-center py-12">
                    <svg className="animate-spin h-8 w-8 text-primary-600" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  </div>
                ) : auditLogs.length === 0 ? (
                  <div className="p-8 text-center text-surface-500 dark:text-surface-400">
                    No audit events found for this VM.
                  </div>
                ) : (
                  <div className="divide-y divide-surface-200 dark:divide-surface-700 max-h-[60vh] overflow-y-auto">
                    {auditLogs.map((log) => (
                      <div key={log.id} className="p-4 hover:bg-surface-50 dark:hover:bg-surface-900/50">
                        <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Badge className={getSeverityColor(log.severity)} variant="outline">
                              {log.severity.toUpperCase()}
                            </Badge>
                            <Badge variant="neutral" className="text-xs">
                              {formatEventType(log.eventType)}
                            </Badge>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-surface-900 dark:text-surface-100 text-sm">{log.message}</p>
                            {log.metadata && (
                              <details className="mt-2">
                                <summary className="text-xs text-surface-500 dark:text-surface-400 cursor-pointer hover:text-surface-700 dark:hover:text-surface-200">
                                  View metadata
                                </summary>
                                <pre className="mt-2 p-2 bg-surface-100 dark:bg-surface-800 rounded text-xs text-surface-600 dark:text-surface-300 overflow-x-auto font-mono">
                                  {JSON.stringify(log.metadata, null, 2)}
                                </pre>
                              </details>
                            )}
                            <time className="text-xs text-surface-500 dark:text-surface-400 font-mono block mt-1" dateTime={log.createdAt}>
                              {formatTimestamp(log.createdAt)}
                            </time>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
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

export default function LogsPage({ params }: LogsPageProps) {
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

  return <LogsContent id={resolvedId} />;
}