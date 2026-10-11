export interface PatternCategories { email: boolean; url: boolean; phone: boolean }
export const DEFAULT_PATTERN_CATEGORIES: Readonly<PatternCategories> = Object.freeze({ email: true, url: true, phone: false });
export const PATTERN_PREFERENCES_KEY = 'patternCategories';
export const PREFERENCES_KEY = 'preferences';
export const THEMES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEMES)[number];
export type PopupMode = 'manual' | 'poetry' | 'pattern-mask';
export interface PopupPreferences { theme: ThemePreference; mode: PopupMode; autoMask: boolean }
export const DEFAULT_POPUP_PREFERENCES: Readonly<PopupPreferences> = Object.freeze({ theme: 'system', mode: 'manual', autoMask: false });

export function validatePopupPreferences(value: unknown): PopupPreferences {
  if (!value || typeof value !== 'object') return { ...DEFAULT_POPUP_PREFERENCES };
  const candidate = value as Partial<PopupPreferences>;
  return {
    theme: THEMES.includes(candidate.theme as ThemePreference) ? candidate.theme as ThemePreference : 'system',
    mode: ['manual', 'poetry', 'pattern-mask'].includes(candidate.mode ?? '') ? candidate.mode as PopupMode : 'manual',
    autoMask: candidate.autoMask === true,
  };
}

export function validatePatternCategories(value: unknown): PatternCategories {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PATTERN_CATEGORIES };
  const candidate = value as Partial<PatternCategories>;
  return typeof candidate.email === 'boolean' && typeof candidate.url === 'boolean' && typeof candidate.phone === 'boolean'
    ? { email: candidate.email, url: candidate.url, phone: candidate.phone }
    : { ...DEFAULT_PATTERN_CATEGORIES };
}
