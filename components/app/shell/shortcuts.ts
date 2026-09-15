// Keyboard shortcuts listed under "?" (14-platform.md, App shell). Modules add theirs here as they land.

export type Shortcut = { keys: string[]; description: string };

export const SHORTCUTS: readonly Shortcut[] = [
  { keys: ['⌘', 'K'], description: 'Open the command palette (Ctrl K on Windows and Linux)' },
  { keys: ['?'], description: 'Show keyboard shortcuts' },
  { keys: ['Esc'], description: 'Close a dialog or menu' },
];

/** Typing in a field, or a key with a modifier, never triggers single-key shortcuts. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function isCommandPaletteKey(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>): boolean {
  // Browsers send keydown events without a key when autofill fills a field.
  if (typeof event.key !== 'string') return false;
  return event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey;
}
