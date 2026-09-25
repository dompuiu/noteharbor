// Theme tokens for 06-palette-theme-tokens — exact port of apps/viewer/flutter/lib/app/viewer_palette.dart + viewer_app.dart
// (Material3, useMaterial3:true). Wired into all 7 components; flat module per human decision.

export const viewerLight = {
  pageBackground: '#F3ECDF',
  surface: '#FFFAF1',
  surfaceContainer: '#EFE5D2',
  border: '#E4D9CB',
  borderSoft: '#EFE6DA',
  borderControl: '#D4C6B4',
  tableHeader: '#E6D9BE',
  text: '#2E2318',
  textMuted: '#8A755A',
  textFaint: '#B5A488',
  // Material3 default hint/prefix color (ColorScheme.onSurfaceVariant):
  // Flutter sets no explicit hint style, so the field hint and magnifier
  // render in this neutral gray, not the warm faint tone.
  searchHint: '#49454F',
  accent: '#96622F',
  accentStrong: '#71461F',
  accentSoft: 'rgba(150,98,47,0.12)',
  success: '#2F6B3C',
  danger: '#A02A22',
  dangerSoft: '#F6E5DC',
  onDanger: '#FFFAF1',
  warning: '#8A5A00',
  info: '#40667C',
  shadow: 'rgba(62,44,20,0.12)',
  tagBackground: '#EFE5D2',
  tagBorder: '#E4D9CB',
  tagText: '#2E2318',
} as const;

export const viewerDark = {
  background: '#201913',
  surface: '#2A2118',
  raised: '#352A1E',
  border: 'rgba(245,240,232,0.16)',
  text: '#F7ECDC',
  muted: 'rgba(245,240,232,0.66)',
  accent: '#E0AA62',
  scrim: 'rgba(247,236,220,0.08)',
  // Light chips reused on dark screens (slideshow tags).
  tagBackground: '#EFE5D2',
  tagBorder: '#E4D9CB',
  tagText: '#2E2318',
} as const;

// Radii actually used in Flutter (10/12 inputs, 18 cards/buttons, 20 dark
// cards, 28 sheets/modals, pill chips). M3 names approximated in RN.
export const viewerRadii = {
  xs: 10,
  sm: 12,
  md: 18,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

// M3 elevations -> RN shadow + Android elevation. Shadow color is viewerLight.shadow.
export const viewerElevation = {
  level0: { elevation: 0 },
  level1: {
    elevation: 1,
    shadowColor: viewerLight.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 2,
  },
  level3: {
    elevation: 3,
    shadowColor: viewerLight.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 8,
  },
} as const;

export const viewerTheme = {
  light: viewerLight,
  dark: viewerDark,
  radii: viewerRadii,
  elevation: viewerElevation,
} as const;

// ponytail: single flat module, no light/dark React context — add when a dark
// RN screen (slideshow/popover) actually ships.
