'use client';

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { VM } from '@/types/vm';

interface VMCardProps {
  vm: VM;
  onRestart?: () => void;
  onShutdown?: () => void;
  onStatus?: () => void;
  onRDPCheck?: () => void;
  onLogs?: () => void;
  onSettings?: () => void;
  onDelete?: () => void;
  disabled?: boolean;
  actionLoading?: boolean;
}

function formatLastSeen(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function getStatusDotColor(status: VM['status']): string {
  switch (status) {
    case 'running':
      return 'bg-green-500';
    case 'stopped':
      return 'bg-surface-400';
    case 'starting':
      return 'bg-yellow-500 animate-pulse';
    case 'stopping':
      return 'bg-orange-500 animate-pulse';
  }
}

export function VMCard({
  vm,
  onRestart,
  onShutdown,
  onStatus,
  onRDPCheck,
  onLogs,
  onSettings,
  onDelete,
  disabled = false,
  actionLoading = false,
}: VMCardProps) {
  const isRunning = vm.status === 'running';
  const isActionDisabled = disabled || actionLoading || !['running', 'starting', 'stopping'].includes(vm.status);

  return (
    <Card hover className="overflow-hidden">
      <div className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${getStatusDotColor(vm.status)}`} aria-hidden="true" />
              <div className="min-w-0">
                <Link
                  href={`/vms/${vm.id}`}
                  className="font-semibold text-surface-900 dark:text-surface-50 truncate block hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                >
                  {vm.name}
                </Link>
                <p className="text-sm text-surface-500 dark:text-surface-400 truncate">{vm.ip}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2 sm:mt-0 sm:ml-4">
              <Badge variant={vm.status === 'running' ? 'running' : 'stopped'}>
                {vm.status.charAt(0).toUpperCase() + vm.status.slice(1)}
              </Badge>
              <Badge variant={vm.rdpHealth === 'healthy' ? 'success' : vm.rdpHealth === 'degraded' ? 'warning' : 'neutral'}>
                RDP: {vm.rdpHealth.charAt(0).toUpperCase() + vm.rdpHealth.slice(1)}
              </Badge>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:ml-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={onRestart}
              disabled={isActionDisabled}
              aria-label={`Restart ${vm.name}`}
              isLoading={actionLoading}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span className="hidden sm:inline">Restart</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onShutdown}
              disabled={isActionDisabled}
              aria-label={`Shutdown ${vm.name}`}
              isLoading={actionLoading}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14v6m-3-3h6M6 10h2a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2zm10 0h2a2 2 0 002-2V6a2 2 0 00-2-2h-2a2 2 0 00-2 2v2a2 2 0 002 2zM6 20h.01M17 20h.01" />
              </svg>
              <span className="hidden sm:inline">Shutdown</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onStatus}
              disabled={isActionDisabled}
              aria-label={`Get status for ${vm.name}`}
              isLoading={actionLoading}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="hidden sm:inline">Status</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRDPCheck}
              disabled={isActionDisabled}
              aria-label={`Check RDP for ${vm.name}`}
              isLoading={actionLoading}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span className="hidden sm:inline">RDP Check</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={onLogs} aria-label={`View logs for ${vm.name}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="hidden sm:inline">Logs</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={onSettings} aria-label={`Settings for ${vm.name}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="hidden sm:inline">Settings</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={onDelete} className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20" aria-label={`Delete ${vm.name}`} disabled={actionLoading} isLoading={actionLoading}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span className="hidden sm:inline">Delete</span>
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-surface-200 dark:border-surface-700">
          <div>
            <p className="text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">CPU</p>
            <p className="mt-1 text-lg font-mono font-semibold text-surface-900 dark:text-surface-50">{vm.cpu}%</p>
          </div>
          <div>
            <p className="text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">RAM</p>
            <p className="mt-1 text-lg font-mono font-semibold text-surface-900 dark:text-surface-50">{vm.ram}%</p>
          </div>
          <div>
            <p className="text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">Disk</p>
            <p className="mt-1 text-lg font-mono font-semibold text-surface-900 dark:text-surface-50">{vm.disk}%</p>
          </div>
          <div>
            <p className="text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">Last Seen</p>
            <p className="mt-1 text-sm font-medium text-surface-700 dark:text-surface-300">{formatLastSeen(vm.lastSeen)}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-surface-500 dark:text-surface-400">
          <span className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Agent: {vm.agentVersion}
          </span>
          <span className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            {vm.os}
          </span>
        </div>
      </div>
    </Card>
  );
}