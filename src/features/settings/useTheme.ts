import { useEffect, useState } from 'react';
import type { ThemePreference } from '../../../shared/settings';

export type ResolvedTheme = 'light' | 'dark';

const QUERY = '(prefers-color-scheme: dark)';

/** `auto` segue o tema do Windows (e acompanha mudanças em tempo real); o resto é fixo. */
export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'light') return 'light';
  if (preference === 'dark') return 'dark';
  return systemDark ? 'dark' : 'light';
}

/** Tema efetivo do painel. Também ajusta `color-scheme` (barras de rolagem e controles nativos). */
export function useTheme(preference: ThemePreference): ResolvedTheme {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(QUERY).matches);

  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const theme = resolveTheme(preference, systemDark);

  useEffect(() => {
    document.documentElement.style.colorScheme = theme;
    document.documentElement.style.background = theme === 'dark' ? '#342b3f' : '#fdf8f3';
  }, [theme]);

  return theme;
}
