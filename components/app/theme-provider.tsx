'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import {
  isThemePreference,
  resolveTheme,
  type ResolvedTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from '@/lib/theme';

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const DARK_QUERY = '(prefers-color-scheme: dark)';

// The stored choice, as an external store: this tab's changes notify directly, other tabs through the storage event.
const preferenceListeners = new Set<() => void>();

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function subscribeToPreference(onChange: () => void) {
  preferenceListeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    preferenceListeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function subscribeToSystemTheme(onChange: () => void) {
  const media = matchMedia(DARK_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/** Keeps the <html> class in step with the viewer's choice and, for "system", with the OS setting. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  // The inline script in the root layout applies the stored theme before paint; the server snapshot is "system".
  const preference = useSyncExternalStore(subscribeToPreference, readStoredPreference, () => 'system' as const);
  const systemPrefersDark = useSyncExternalStore(
    subscribeToSystemTheme,
    () => matchMedia(DARK_QUERY).matches,
    () => false,
  );
  const resolvedTheme = resolveTheme(preference, systemPrefersDark);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      if (next === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage unavailable (some private browsing modes): nothing to persist.
    }
    for (const listener of preferenceListeners) listener();
  }, []);

  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}
