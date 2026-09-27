// How the vault reads on screen (10-vault.md). Labels only: nothing here ever sees a secret.

export const VAULT_KIND_LABEL = {
  login: 'Login',
  api_key: 'API key',
  ssh_key: 'SSH key',
  env_file: 'Environment file',
  note: 'Note',
} as const;

export type VaultKind = keyof typeof VAULT_KIND_LABEL;

export const VAULT_KINDS = Object.keys(VAULT_KIND_LABEL) as VaultKind[];

export const VAULT_STATUS_LABEL = {
  active: 'Active',
  handed_over: 'Handed over',
  archived: 'Archived',
} as const;

/** What the access log says happened, in the words a person would use. */
export const VAULT_ACCESS_LABEL = {
  reveal: 'revealed',
  copy: 'copied',
  refused: 'was refused',
} as const;

/**
 * How a rotation date reads: overdue and today are both worth saying plainly, and a date far off is worth not saying
 * loudly. Returns null when there is no date, so a caller can leave the space empty rather than print "no date".
 */
export function rotationDue(
  rotateByDate: string | undefined,
  today: string,
): { label: string; tone: 'danger' | 'warning' | 'muted' } | null {
  if (!rotateByDate) return null;
  if (rotateByDate < today) return { label: `Rotation overdue since ${rotateByDate}`, tone: 'danger' };
  if (rotateByDate === today) return { label: 'Due to be rotated today', tone: 'danger' };
  const days = Math.round((Date.parse(`${rotateByDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days <= 7) return { label: `Rotate in ${days} ${days === 1 ? 'day' : 'days'}`, tone: 'warning' };
  return { label: `Rotate by ${rotateByDate}`, tone: 'muted' };
}
