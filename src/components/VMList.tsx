'use client';

import { VMCard } from './VMCard';
import type { VM } from '@/types/vm';

interface VMListProps {
  vms: VM[];
}

export function VMList({ vms }: VMListProps) {
  return (
    <div className="space-y-4" role="list" aria-label="Virtual Machines">
      {vms.map((vm) => (
        <VMCard key={vm.id} vm={vm} />
      ))}
    </div>
  );
}