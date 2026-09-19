'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import type { VM } from '@/types/vm';

interface SettingsPageProps {
  params: Promise<{ id: string }>;
}

function formatTimestamp(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString();
}

interface VMSettings {
  monitoring_enabled: boolean;
  auto_rdp_recovery: boolean;
  cpu_warning: number;
  cpu_critical: number;
  ram_warning: number;
  ram_critical: number;
  disk_warning: number;
  disk_critical: number;
  rdp_check_enabled: boolean;
  rdp_check_interval_minutes: number;
  safe_maintenance_mode: boolean;
}

function SettingsContent({ id }: { id: string }) {
  const [vm, setVm] = useState<VM | null>(null);
  const [settings, setSettings] = useState<VMSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [formData, setFormData] = useState<VMSettings>({
    monitoring_enabled: true,
    auto_rdp_recovery: true,
    cpu_warning: 70,
    cpu_critical: 90,
    ram_warning: 75,
    ram_critical: 90,
    disk_warning: 80,
    disk_critical: 95,
    rdp_check_enabled: true,
    rdp_check_interval_minutes: 5,
    safe_maintenance_mode: false,
  });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [vmRes, settingsRes] = await Promise.all([
        fetch(`/api/vms/${id}`),
        fetch(`/api/vms/${id}/settings`),
      ]);

      if (!vmRes.ok) throw new Error('Failed to fetch VM');
      const vmData = await vmRes.json();
      const apiVm = vmData.vm;
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

      if (!settingsRes.ok) throw new Error('Failed to fetch settings');
      const settingsData = await settingsRes.json();
      const s = settingsData.settings;
      setSettings({
        monitoring_enabled: !!s.monitoring_enabled,
        auto_rdp_recovery: !!s.auto_rdp_recovery,
        cpu_warning: s.cpu_warning,
        cpu_critical: s.cpu_critical,
        ram_warning: s.ram_warning,
        ram_critical: s.ram_critical,
        disk_warning: s.disk_warning,
        disk_critical: s.disk_critical,
        rdp_check_enabled: !!s.rdp_check_enabled,
        rdp_check_interval_minutes: s.rdp_check_interval_minutes || 5,
        safe_maintenance_mode: !!s.safe_maintenance_mode,
      });
      setFormData({
        monitoring_enabled: !!s.monitoring_enabled,
        auto_rdp_recovery: !!s.auto_rdp_recovery,
        cpu_warning: s.cpu_warning,
        cpu_critical: s.cpu_critical,
        ram_warning: s.ram_warning,
        ram_critical: s.ram_critical,
        disk_warning: s.disk_warning,
        disk_critical: s.disk_critical,
        rdp_check_enabled: !!s.rdp_check_enabled,
        rdp_check_interval_minutes: s.rdp_check_interval_minutes || 5,
        safe_maintenance_mode: !!s.safe_maintenance_mode,
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleChange = (field: keyof VMSettings, value: boolean | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/vms/${id}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save settings');
      }
      setSuccess('Settings saved successfully');
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (!vm) {
    return (
      <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
        <Header />
        <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-50">VM Not Found</h1>
            <Link href="/dashboard" className="mt-4 inline-block text-primary-600 hover:text-primary-700">
              ← Back to Dashboard
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      <Header />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="animate-in">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div>
              <Link
                href={`/vms/${id}`}
                className="text-sm text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200"
              >
                ← Back to VM
              </Link>
              <h1 className="mt-1 text-2xl sm:text-3xl font-bold text-surface-900 dark:text-surface-50 tracking-tight">
                Settings: {vm.name}
              </h1>
            </div>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm" role="alert">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-300 text-sm" role="status">
              {success}
            </div>
          )}

          <Card>
            <CardContent className="p-6 space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50 mb-4">Monitoring</h2>
                <div className="space-y-4">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.monitoring_enabled}
                      onChange={(e) => handleChange('monitoring_enabled', e.target.checked)}
                      className="w-4 h-4 rounded border-surface-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-surface-900 dark:text-surface-50">Enable Monitoring</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.auto_rdp_recovery}
                      onChange={(e) => handleChange('auto_rdp_recovery', e.target.checked)}
                      className="w-4 h-4 rounded border-surface-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-surface-900 dark:text-surface-50">Auto RDP Recovery</span>
                    <Badge variant="info" className="ml-auto text-xs">Auto-restart RDP service when degraded</Badge>
                  </label>
                </div>
              </div>

              <div>
                <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50 mb-4">RDP Health Checks</h2>
                <div className="space-y-4">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.rdp_check_enabled}
                      onChange={(e) => handleChange('rdp_check_enabled', e.target.checked)}
                      className="w-4 h-4 rounded border-surface-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-surface-900 dark:text-surface-50">Enable Periodic RDP Checks</span>
                  </label>
                  <div className="ml-6">
                    <Input
                      label="Check Interval (minutes)"
                      type="number"
                      min={1}
                      max={60}
                      value={formData.rdp_check_interval_minutes}
                      onChange={(e) => handleChange('rdp_check_interval_minutes', parseInt(e.target.value) || 1)}
                      required
                    />
                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">How often the agent should check RDP status and report back.</p>
                  </div>
                </div>
              </div>

              <div>
                <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50 mb-4">Safe Maintenance Mode</h2>
                <div className="space-y-4">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.safe_maintenance_mode}
                      onChange={(e) => handleChange('safe_maintenance_mode', e.target.checked)}
                      className="w-4 h-4 rounded border-surface-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-surface-900 dark:text-surface-50">Enable Safe Maintenance Mode</span>
                    <Badge variant="warning" className="ml-auto text-xs">Blocks restart/shutdown commands</Badge>
                  </label>
                  <p className="text-sm text-surface-600 dark:text-surface-400 ml-6">
                    When enabled, restart and shutdown commands will be rejected. Useful during planned maintenance windows.
                  </p>
                </div>
              </div>

              <div>
                <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50 mb-4">CPU Thresholds (%)</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="Warning"
                    type="number"
                    min={0}
                    max={100}
                    value={formData.cpu_warning}
                    onChange={(e) => handleChange('cpu_warning', parseInt(e.target.value) || 0)}
                    required
                  />
                  <Input
                    label="Critical"
                    type="number"
                    min={0}
                    max={100}
                    value={formData.cpu_critical}
                    onChange={(e) => handleChange('cpu_critical', parseInt(e.target.value) || 0)}
                    required
                  />
                </div>
              </div>

              <div>
                <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50 mb-4">RAM Thresholds (%)</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="Warning"
                    type="number"
                    min={0}
                    max={100}
                    value={formData.ram_warning}
                    onChange={(e) => handleChange('ram_warning', parseInt(e.target.value) || 0)}
                    required
                  />
                  <Input
                    label="Critical"
                    type="number"
                    min={0}
                    max={100}
                    value={formData.ram_critical}
                    onChange={(e) => handleChange('ram_critical', parseInt(e.target.value) || 0)}
                    required
                  />
                </div>
              </div>

              <div>
                <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50 mb-4">Disk Thresholds (%)</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="Warning"
                    type="number"
                    min={0}
                    max={100}
                    value={formData.disk_warning}
                    onChange={(e) => handleChange('disk_warning', parseInt(e.target.value) || 0)}
                    required
                  />
                  <Input
                    label="Critical"
                    type="number"
                    min={0}
                    max={100}
                    value={formData.disk_critical}
                    onChange={(e) => handleChange('disk_critical', parseInt(e.target.value) || 0)}
                    required
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-surface-200 dark:border-surface-700">
                <div className="flex justify-end gap-3">
                  <Button variant="outline" onClick={fetchData} disabled={saving}>
                    Reset
                  </Button>
                  <Button onClick={handleSave} disabled={saving} isLoading={saving}>
                    Save Settings
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardContent className="p-6">
              <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50 mb-4">Enrollment</h2>
              <div className="space-y-3 text-sm text-surface-600 dark:text-surface-400">
                <p>To install the agent on this VM, generate an enrollment token:</p>
                <Button variant="outline" onClick={async () => {
                  try {
                    const res = await fetch(`/api/vms/${id}/enrollment-token`, { method: 'POST' });
                    if (!res.ok) throw new Error('Failed to generate token');
                    const data = await res.json();
                    alert(`Enrollment token (save this - shown once):\n${data.enrollment_token}\n\nExpires: ${data.expires_at}`);
                  } catch (err) {
                    alert(err instanceof Error ? err.message : 'Failed to generate token');
                  }
                }}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                  Generate Enrollment Token
                </Button>
                <p className="text-xs">Token expires in 30 minutes. The agent credential is returned only once.</p>
              </div>
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

export default function SettingsPage({ params }: SettingsPageProps) {
  const [resolvedId, setResolvedId] = useState<string | null>(null);

  useEffect(() => {
    params.then(p => setResolvedId(p.id));
  }, [params]);

  if (!resolvedId) {
    return (
      <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
        <Header />
        <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
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

  return <SettingsContent id={resolvedId} />;
}