/**
 * Theme registry — maps theme name → Theme token object.
 *
 * Adding a community theme: import it here, add an entry to `registry`.
 * The name must be a valid `@theme` directive value (lowercase, no spaces).
 */

import { cleanTheme, type Theme } from './clean.js';
import { cleanDarkTheme } from './clean-dark.js';

const registry: Record<string, Theme> = {
  'clean':      cleanTheme,
  'clean-dark': cleanDarkTheme,
};

/**
 * Resolve a theme name to its token object.
 * Falls back to `cleanTheme` for unknown names.
 */
export function resolveTheme(name: string): Theme {
  return registry[name.toLowerCase().trim()] ?? cleanTheme;
}

/**
 * List all registered theme names (for dropdowns, docs, etc.).
 */
export function listThemes(): string[] {
  return Object.keys(registry);
}

export type { Theme };
