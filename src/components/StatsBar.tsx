'use client';

import React from 'react';

interface StatsBarProps {
  stats: {
    total: number;
    running: number;
    stopped: number;
    healthy: number;
  };
}

const statCards = [
  { key: 'total', label: 'Total VMs', color: 'primary', icon: 'server' },
  { key: 'running', label: 'Running', color: 'success', icon: 'play' },
  { key: 'stopped', label: 'Stopped', color: 'warning', icon: 'pause' },
  { key: 'healthy', label: 'RDP Healthy', color: 'info', icon: 'check' },
] as const;

const icons: Record<string, React.ReactElement> = {
  server: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
    </svg>
  ),
  play: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  pause: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  check: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
};

const colorClasses: Record<string, string> = {
  primary: 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300',
  success: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300',
  warning: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300',
  info: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300',
};

export function StatsBar({ stats }: StatsBarProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4" role="region" aria-label="VM Statistics">
      {statCards.map(({ key, label, color, icon }) => (
        <div
          key={key}
          className={`card p-4 ${colorClasses[color]}`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider opacity-80">{label}</p>
              <p className="mt-1 text-2xl sm:text-3xl font-bold">
                {stats[key as keyof typeof stats]}
              </p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-white/50 dark:bg-surface-800/50 flex items-center justify-center opacity-80">
              {icons[icon]}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}