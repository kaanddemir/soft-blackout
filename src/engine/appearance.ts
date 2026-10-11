export const BLACKOUT_STYLES = ['solid', 'marker'] as const;
export type BlackoutStyle = (typeof BLACKOUT_STYLES)[number];

export const BLACKOUT_COLORS = ['#242321', '#f7f4ec', '#a65d51', '#a8977c', '#65786c'] as const;
export type BlackoutColor = (typeof BLACKOUT_COLORS)[number];

export interface BlackoutAppearance {
  style: BlackoutStyle;
  color: BlackoutColor;
}

export const DEFAULT_APPEARANCE: BlackoutAppearance = { style: 'solid', color: '#242321' };

export function validateAppearance(value: unknown): BlackoutAppearance | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<BlackoutAppearance>;
  if (!BLACKOUT_STYLES.includes(candidate.style as BlackoutStyle)) return null;
  if (!BLACKOUT_COLORS.includes(candidate.color as BlackoutColor)) return null;
  return { style: candidate.style as BlackoutStyle, color: candidate.color as BlackoutColor };
}

export function appearanceKey(appearance: BlackoutAppearance): string {
  return `${appearance.style}-${appearance.color.slice(1)}`;
}
