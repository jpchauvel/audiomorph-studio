'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const linkBase =
  'no-drag px-3 py-1 rounded-md text-xs font-medium transition-colors';
const activeCls = 'bg-[var(--color-surface-3)] text-[var(--color-text)]';
const inactiveCls =
  'text-[var(--color-text-muted)] hover:text-[var(--color-text)]';

export function AppHeader() {
  const pathname = usePathname();
  const isStudio = pathname === '/';
  const isModels = pathname?.startsWith('/models') ?? false;

  return (
    <header
      data-testid="app-titlebar"
      className="titlebar-drag flex items-center h-9 pl-20 pr-3 gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] select-none"
    >
      <span className="no-drag text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
        AudioMorph
      </span>
      <nav className="no-drag flex items-center gap-1">
        <Link
          href="/"
          data-testid="nav-studio"
          className={`${linkBase} ${isStudio ? activeCls : inactiveCls}`}
        >
          Studio
        </Link>
        <Link
          href="/models"
          data-testid="nav-models"
          className={`${linkBase} ${isModels ? activeCls : inactiveCls}`}
        >
          Models
        </Link>
      </nav>
    </header>
  );
}
