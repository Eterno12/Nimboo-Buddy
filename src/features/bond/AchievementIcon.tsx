import type { AchievementDef } from '../../../shared/achievements';

const PATHS: Record<AchievementDef['icon'], string> = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  note: 'M7 4h10a1 1 0 011 1v14l-3-2-3 2-3-2-3 2V5a1 1 0 011-1zM9 9h6M9 12.5h4',
  focus: 'M12 5a7 7 0 100 14 7 7 0 000-14zM12 8.5V12l2.5 1.5',
  heart: 'M12 19s-6.5-4-6.5-8.6A3.6 3.6 0 0112 8.3a3.6 3.6 0 016.5 2.1C18.5 15 12 19 12 19z',
  calendar: 'M5 7h14v12H5zM5 11h14M9 4v4M15 4v4',
  flame: 'M12 4c1 3.5 5 5 5 9.5A5 5 0 017 13.5c0-2 1-3 2-4 .2 1.5 1 2 1.8 2C10.5 8.5 11 6 12 4z',
  chat: 'M5 6h14v9H10l-4 3.5V15H5z',
  star: 'M12 4.5l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 9.8l5-.7z',
  moon: 'M16.5 14.5A6.5 6.5 0 019.5 7.5a6.5 6.5 0 107 7z',
  sun: 'M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4',
  people: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3.5 19c.3-3 2.5-4.5 5.5-4.5s5.2 1.5 5.5 4.5M16.5 11a2.5 2.5 0 100-5M17 14.7c2 .3 3.2 1.8 3.5 4.3',
  list: 'M9 7h10M9 12h10M9 17h10M5 7h.01M5 12h.01M5 17h.01',
  mic: 'M12 4a3 3 0 013 3v5a3 3 0 01-6 0V7a3 3 0 013-3zM6.5 11.5a5.5 5.5 0 0011 0M12 17v3',
  trophy: 'M8 4h8v5a4 4 0 01-8 0zM8 6H5v1.5A3 3 0 008 10.5M16 6h3v1.5a3 3 0 01-3 3M12 13v4M8.5 20h7M10 17h4',
};

export function AchievementIcon({ name }: { name: AchievementDef['icon'] }) {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" focusable="false">
      <path d={PATHS[name] ?? PATHS.star} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
