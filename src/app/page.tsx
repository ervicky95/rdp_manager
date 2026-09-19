'use client';

import { useState } from 'react';
import { VMList } from '@/components/VMList';
import { Header } from '@/components/Header';
import { StatsBar } from '@/components/StatsBar';
import { EmptyState } from '@/components/EmptyState';
import { mockVMs, getMockStats } from '@/lib/mock-data';
import type { VM } from '@/types/vm';

export default function HomePage() {
  const [vms] = useState<VM[]>(mockVMs);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'stopped'>('all');

  const filteredVMs = vms.filter((vm) => {
    const matchesSearch = vm.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vm.ip.includes(searchQuery);
    const matchesStatus = statusFilter === 'all' || vm.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const stats = getMockStats();

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="animate-in">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-surface-900 dark:text-surface-50 tracking-tight">
                VM Inventory
              </h1>
              <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
                Manage your temporary Windows VMs
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button className="btn-primary" disabled>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add VM
              </button>
            </div>
          </div>

          <StatsBar stats={stats} />

          <div className="mt-6">
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <div className="relative flex-1 max-w-xs">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="search"
                  placeholder="Search by name or IP..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="input pl-10"
                  aria-label="Search VMs"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | 'running' | 'stopped')}
                className="input max-w-xs sm:w-auto"
                aria-label="Filter by status"
              >
                <option value="all">All Status</option>
                <option value="running">Running</option>
                <option value="stopped">Stopped</option>
              </select>
            </div>

            {filteredVMs.length > 0 ? (
              <VMList vms={filteredVMs} />
            ) : (
              <EmptyState
                title="No VMs found"
                description={searchQuery || statusFilter !== 'all'
                  ? 'Try adjusting your search or filter criteria.'
                  : 'Get started by adding your first Windows VM.'}
                actionLabel="Add VM"
                onAction={() => {}}
              />
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-surface-200 dark:border-surface-800 py-6 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-surface-500 dark:text-surface-400">
          <p>RDP Manager v0.1.0 — Personal VM Management</p>
          <p className="font-mono text-xs">
            Next.js 14 • Tailwind CSS • Cloudflare Workers
          </p>
        </div>
      </footer>
    </div>
  );
}