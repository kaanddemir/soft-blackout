import { describe, expect, it } from 'vitest';
import { DEFAULT_PATTERN_CATEGORIES, DEFAULT_POPUP_PREFERENCES, validatePatternCategories, validatePopupPreferences } from '../../src/shared/settings';

describe('Pattern category preferences', () => {
  it('uses validated conservative defaults and recovers malformed values', () => {
    expect(DEFAULT_PATTERN_CATEGORIES).toEqual({ email: true, url: true, phone: false });
    expect(validatePatternCategories({ email: false, url: true, phone: true })).toEqual({ email: false, url: true, phone: true });
    expect(validatePatternCategories({ email: 'yes' })).toEqual(DEFAULT_PATTERN_CATEGORIES);
  });
});

describe('Popup preferences', () => {
  it('defaults to System and Manual and validates independent fields', () => {
    expect(DEFAULT_POPUP_PREFERENCES).toEqual({ theme: 'system', mode: 'manual', autoMask: false });
    expect(validatePopupPreferences({ theme: 'dark', mode: 'poetry' })).toEqual({ theme: 'dark', mode: 'poetry', autoMask: false });
    expect(validatePopupPreferences({ theme: 'dark', mode: 'manual', autoMask: true }).autoMask).toBe(true);
    expect(validatePopupPreferences({ autoMask: 'yes' }).autoMask).toBe(false);
    expect(validatePopupPreferences({ theme: 'neon', mode: 'random' })).toEqual(DEFAULT_POPUP_PREFERENCES);
  });
});
