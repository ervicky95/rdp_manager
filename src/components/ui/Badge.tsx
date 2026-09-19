'use client';

import { type HTMLAttributes } from 'react';

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'running' | 'stopped' | 'outline';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantStyles: Record<BadgeVariant, string> = {
  success: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  neutral: 'bg-surface-100 text-surface-700 dark:bg-surface-700 dark:text-surface-300',
  running: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  stopped: 'bg-surface-100 text-surface-700 dark:bg-surface-700 dark:text-surface-300',
  outline: 'bg-transparent border border-surface-300 text-surface-700 dark:border-surface-600 dark:text-surface-300',
};

export function Badge({ variant = 'neutral', className = '', children, ...props }: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium
        ${variantStyles[variant]} ${className}
      `}
      {...props}
    >
      {children}
    </span>
  );
}