'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { Button } from './ui/Button';

/** Instant theme toggle with no layout change (UI_GUIDELINES.md §4). */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === 'dark';

  return (
    <Button
      variant="secondary"
      size="sm"
      aria-label="Toggle theme"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {mounted && isDark ? <Sun size={16} /> : <Moon size={16} />}
      <span>{mounted ? (isDark ? 'Light' : 'Dark') : 'Theme'}</span>
    </Button>
  );
}
