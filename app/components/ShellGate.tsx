'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import AppShell from '@/app/components/AppShell';

// Wraps every /dashboard and /admin page in one AppShell that lives in the root
// layout, so moving between the two sections keeps the sidebar, session and
// alerts mounted instead of reloading them.
const SHELL_PREFIXES = ['/dashboard', '/admin'];

export default function ShellGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const inShell = SHELL_PREFIXES.some(p => pathname === p || pathname.startsWith(`${p}/`));
  return inShell ? <AppShell>{children}</AppShell> : <>{children}</>;
}
