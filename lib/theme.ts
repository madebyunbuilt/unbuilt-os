// Dark mode follows the system unless the viewer picks light or dark (docs/spec/01-product.md, Design).

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'unbuilt-theme';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  return preference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preference;
}

/**
 * Runs in <head> before the first paint so the page never flashes the wrong theme. Rendered by the root layout (a
 * server component): React only warns about scripts rendered from client components.
 */
export const themeScript = `(function(){try{var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var d=p==="dark"||((p!=="light")&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"}catch(e){}})()`;
