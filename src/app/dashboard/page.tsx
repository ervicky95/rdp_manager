'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { StatsBar } from '@/components/StatsBar';
import { VMCard } from '@/components/VMCard';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Card, CardContent } from '@/components/ui/Card';
import type { VM, Command } from '@/types/vm';

interface APIVM {
  id: string;
  name: string;
  ip_address: string;
  status: 'running' | 'stopped' | 'starting' | 'stopping';
  agent_id: string | null;
  agent_version: string | null;
  windows_version: string | null;
  cpu_percent: number;
  ram_percent: number;
  disk_percent: number;
  rdp_status: 'healthy' | 'degraded' | 'unknown' | 'unreachable';
  uptime_seconds: number;
  last_seen: string;
  created_at: string;
}

function mapAPIVMToVM(vm: APIVM): VM {
  return {
    id: vm.id,
    name: vm.name,
    ip: vm.ip_address,
    status: vm.status,
    os: vm.windows_version || 'Windows',
    agentVersion: vm.agent_version || 'unknown',
    lastSeen: vm.last_seen,
    rdpHealth: vm.rdp_status,
    cpu: vm.cpu_percent,
    ram: vm.ram_percent,
    disk: vm.disk_percent,
    createdAt: vm.created_at,
  };
}

function calculateStats(vms: VM[]) {
  return {
    total: vms.length,
    running: vms.filter((v) => v.status === 'running').length,
    stopped: vms.filter((v) => v.status === 'stopped').length,
    healthy: vms.filter((v) => v.rdpHealth === 'healthy').length,
  };
}

type SortBy = 'name' | 'cpu' | 'ram' | 'disk' | 'lastSeen' | 'createdAt';
type SortOrder = 'asc' | 'desc';
type StatusFilter = 'all' | 'running' | 'stopped' | 'starting' | 'stopping';
type RDPFilter = 'all' | 'healthy' | 'degraded' | 'unknown' | 'unreachable';

export default function DashboardPage() {
  const [vms, setVms] = useState<VM[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [rdpFilter, setRdpFilter] = useState<RDPFilter>('all');
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('createdAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newVMName, setNewVMName] = useState('');
  const [newVMIP, setNewVMIP] = useState('');
  const [deleteVMId, setDeleteVMId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const fetchVMs = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (rdpFilter !== 'all') params.set('rdp_status', rdpFilter);
      if (onlineOnly) params.set('online', 'true');
      params.set('sort_by', sortBy);
      params.set('sort_order', sortOrder);
      params.set('limit', '100');

      const res = await fetch(`/api/vms?${params.toString()}`);
      if (!res.ok) {
        if (res.status === 401) {
          window.location.href = '/login?redirect=/dashboard';
          return;
        }
        throw new Error('Failed to fetch VMs');
      }
      const data = await res.json();
      setVms(data.vms.map(mapAPIVMToVM));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load VMs');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter, rdpFilter, onlineOnly, sortBy, sortOrder]);

  useEffect(() => {
    fetchVMs();
    // Poll for updates every 30 seconds
    const interval = setInterval(fetchVMs, 30000);
    return () => clearInterval(interval);
  }, [fetchVMs]);

  const handleSort = (field: SortBy) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const handleAction = async (vmId: string, action: 'restart' | 'shutdown' | 'status' | 'rdp_check') => {
    setActionLoading(vmId);
    try {
      const res = await fetch(`/api/vms/${vmId}/${action}`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        if (res.status === 429) {
          throw new Error(`${err.error} Try again after ${new Date(err.resetAt).toLocaleTimeString()}.`);
        }
        throw new Error(err.error || `Failed to ${action}`);
      }
      // Refresh VMs after action
      await fetchVMs();
    } catch (err) {
      alert(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = (id: string) => {
    setDeleteVMId(id);
  };

  const confirmDelete = async () => {
    if (!deleteVMId) return;
    setActionLoading(deleteVMId);
    try {
      const res = await fetch(`/api/vms/${deleteVMId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete VM');
      }
      await fetchVMs();
      setDeleteVMId(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete VM');
    } finally {
      setActionLoading(null);
    }
  };

  const handleAddVM = async () => {
    if (!newVMName || !newVMIP) return;
    setActionLoading('add');
    try {
      const res = await fetch('/api/vms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newVMName.trim(), ip_address: newVMIP.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to add VM');
      }
      const data = await res.json();
      // Show enrollment token to user
      alert(`VM created! Enrollment token (save this - shown once):\n${data.enrollment_token}\n\nExpires: ${data.expires_at}`);
      setShowAddModal(false);
      setNewVMName('');
      setNewVMIP('');
      await fetchVMs();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add VM');
    } finally {
      setActionLoading(null);
    }
  };

  const isActionDisabled = (vm: VM) => actionLoading === vm.id || !['running', 'starting', 'stopping'].includes(vm.status);

  const stats = calculateStats(vms);

  const sortIcon = (field: SortBy) => {
    if (sortBy !== field) return (
      <svg className="w-4 h-4 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4M17 16V4m0 0l4 4m-4-4l-4 4" />
      </svg>
    );
    return sortOrder === 'asc' ? (
      <svg className="w-4 h-4 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="w-4 h-4 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    );
  };

  const sortableHeaders = [
    { key: 'name' as SortBy, label: 'Name' },
    { key: 'cpu' as SortBy, label: 'CPU %' },
    { key: 'ram' as SortBy, label: 'RAM %' },
    { key: 'disk' as SortBy, label: 'Disk %' },
    { key: 'lastSeen' as SortBy, label: 'Last Seen' },
    { key: 'createdAt' as SortBy, label: 'Created' },
  ];

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="animate-in">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-surface-900 dark:text-surface-50 tracking-tight">
                Dashboard
              </h1>
              <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
                Overview of your Windows VMs
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <Button onClick={() => setShowAddModal(true)} disabled={actionLoading === 'add'} className="w-full sm:w-auto">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add VM
              </Button>
            </div>
          </div>

          <StatsBar stats={stats} />

          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm" role="alert">
              {error}
            </div>
          )}

          <div className="mt-6">
            {/* Filters and Search */}
            <Card className="mb-6">
              <CardContent className="p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row gap-4">
                  {/* Search */}
                  <div className="relative flex-1 max-w-xs sm:max-w-md">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      type="search"
                      placeholder="Search by name or IP..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="input pl-10 w-full"
                      aria-label="Search VMs"
                    />
                  </div>

                  {/* Status Filter */}
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                    className="input max-w-xs sm:w-auto"
                    aria-label="Filter by status"
                  >
                    <option value="all">All Status</option>
                    <option value="running">Running</option>
                    <option value="stopped">Stopped</option>
                    <option value="starting">Starting</option>
                    <option value="stopping">Stopping</option>
                  </select>

                  {/* RDP Filter */}
                  <select
                    value={rdpFilter}
                    onChange={(e) => setRdpFilter(e.target.value as RDPFilter)}
                    className="input max-w-xs sm:w-auto"
                    aria-label="Filter by RDP status"
                  >
                    <option value="all">All RDP Status</option>
                    <option value="healthy">Healthy</option>
                    <option value="degraded">Degraded</option>
                    <option value="unknown">Unknown</option>
                    <option value="unreachable">Unreachable</option>
                  </select>

                  {/* Online Only */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={onlineOnly}
                      onChange={(e) => setOnlineOnly(e.target.checked)}
                      className="w-4 h-4 rounded border-surface-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-surface-700 dark:text-surface-300">Online only ({"<"} 5 min)</span>
                  </label>
                </div>
              </CardContent>
            </Card>

            {/* Sortable VM Grid */}
            {loading && vms.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <svg className="animate-spin h-8 w-8 text-primary-600" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
            ) : vms.length > 0 ? (
              <>
                {/* Desktop Table View */}
                <div className="hidden lg:block">
                  <div className="overflow-x-auto">
                    <table className="w-full" role="grid">
                      <thead>
                        <tr className="border-b border-surface-200 dark:border-surface-700">
                          {sortableHeaders.map(({ key, label }) => (
                            <th key={key} className="px-4 py-3 text-left text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider cursor-pointer hover:text-surface-700 dark:hover:text-surface-200 select-none"
                                onClick={() => handleSort(key)}>
                              <div className="flex items-center gap-1">
                                {label}
                                {sortIcon(key)}
                              </div>
                            </th>
                          ))}
                          <th className="px-4 py-3 text-left text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">
                            RDP
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">
                            Status
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-200 dark:divide-surface-700">
                        {vms.map((vm) => (
                          <tr key={vm.id} className="hover:bg-surface-50 dark:hover:bg-surface-900/50">
                            <td className="px-4 py-3">
                              <div className="font-medium text-surface-900 dark:text-surface-100">{vm.name}</div>
                              <div className="text-sm text-surface-500 dark:text-surface-400 font-mono">{vm.ip}</div>
                            </td>
                            <td className="px-4 py-3 text-sm text-surface-900 dark:text-surface-100 font-mono">
                              {vm.cpu}%
                            </td>
                            <td className="px-4 py-3 text-sm text-surface-900 dark:text-surface-100 font-mono">
                              {vm.ram}%
                            </td>
                            <td className="px-4 py-3 text-sm text-surface-900 dark:text-surface-100 font-mono">
                              {vm.disk}%
                            </td>
                            <td className="px-4 py-3 text-sm text-surface-500 dark:text-surface-400">
                              {new Date(vm.lastSeen).toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-sm text-surface-500 dark:text-surface-400">
                              {new Date(vm.createdAt).toLocaleDateString()}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                vm.rdpHealth === 'healthy' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' :
                                vm.rdpHealth === 'degraded' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' :
                                vm.rdpHealth === 'unreachable' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' :
                                'bg-surface-100 text-surface-800 dark:bg-surface-800 dark:text-surface-300'
                              }`}>
                                {vm.rdpHealth.charAt(0).toUpperCase() + vm.rdpHealth.slice(1)}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                vm.status === 'running' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' :
                                vm.status === 'stopped' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' :
                                vm.status === 'starting' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' :
                                'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
                              }`}>
                                {vm.status.charAt(0).toUpperCase() + vm.status.slice(1)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleAction(vm.id, 'status')}
                                  disabled={isActionDisabled(vm) || actionLoading === vm.id}
                                  isLoading={actionLoading === vm.id}
                                >
                                  Status
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleAction(vm.id, 'rdp_check')}
                                  disabled={isActionDisabled(vm) || actionLoading === vm.id}
                                  isLoading={actionLoading === vm.id}
                                >
                                  RDP
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleAction(vm.id, 'restart')}
                                  disabled={isActionDisabled(vm) || actionLoading === vm.id}
                                  isLoading={actionLoading === vm.id}
                                >
                                  Restart
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => handleAction(vm.id, 'shutdown')}
                                  disabled={isActionDisabled(vm) || actionLoading === vm.id}
                                  isLoading={actionLoading === vm.id}
                                >
                                  Shutdown
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => window.location.href = `/vms/${vm.id}/logs`}
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                  </svg>
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => window.location.href = `/vms/${vm.id}/settings`}
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                  </svg>
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDelete(vm.id)}
                                >
                                  <svg className="w-4 h-4 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Mobile Card View */}
                <div className="lg:hidden">
                  <div className="grid grid-cols-1 gap-4" role="list" aria-label="Virtual Machines">
                    {vms.map((vm) => (
                      <VMCard
                        key={vm.id}
                        vm={vm}
                        onRestart={() => handleAction(vm.id, 'restart')}
                        onShutdown={() => handleAction(vm.id, 'shutdown')}
                        onStatus={() => handleAction(vm.id, 'status')}
                        onRDPCheck={() => handleAction(vm.id, 'rdp_check')}
                        onLogs={() => window.location.href = `/vms/${vm.id}/logs`}
                        onSettings={() => window.location.href = `/vms/${vm.id}/settings`}
                        onDelete={() => handleDelete(vm.id)}
                        disabled={isActionDisabled(vm)}
                        actionLoading={actionLoading === vm.id}
                      />
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <EmptyState
                title="No VMs found"
                description={searchQuery || statusFilter !== 'all' || rdpFilter !== 'all' || onlineOnly
                  ? 'Try adjusting your search or filter criteria.'
                  : 'Get started by adding your first Windows VM.'}
                actionLabel="Add VM"
                onAction={() => setShowAddModal(true)}
              />
            )}
          </div>
        </div>
      </main>

      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add New VM"
        description="Enter the VM details to add it to your inventory."
        actionLabel="Add VM"
        onAction={handleAddVM}
        loading={actionLoading === 'add'}
      >
        <form onSubmit={(e) => { e.preventDefault(); handleAddVM(); }} className="space-y-4">
          <Input
            label="VM Name"
            value={newVMName}
            onChange={(e) => setNewVMName(e.target.value)}
            placeholder="e.g., dev-windows-01"
            required
            autoFocus
          />
          <Input
            label="IP Address"
            type="text"
            value={newVMIP}
            onChange={(e) => setNewVMIP(e.target.value)}
            placeholder="e.g., 20.123.45.67"
            required
          />
        </form>
      </Modal>

      <Modal
        isOpen={!!deleteVMId}
        onClose={() => setDeleteVMId(null)}
        title="Delete VM"
        description={`This will remove the VM record from your dashboard. This action does not affect the actual VM or Azure resources.`}
        actionLabel="Delete"
        onAction={confirmDelete}
        actionVariant="destructive"
        loading={actionLoading === deleteVMId}
      >
        <p className="text-surface-600 dark:text-surface-400">Are you sure you want to delete this VM record?</p>
      </Modal>

      <footer className="border-t border-surface-200 dark:border-surface-800 py-6 px-4 sm:px-6 lg:px-8 mt-12">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-surface-500 dark:text-surface-400">
          <p>RDP Manager v0.1.0 — Personal VM Management</p>
          <p className="font-mono text-xs">Next.js 14 • Tailwind CSS • Cloudflare Workers</p>
        </div>
      </footer>
    </div>
  );
}