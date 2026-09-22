// Settings sections (14-platform.md, Settings). Each shows when the role holds any of its permissions; sections whose
// screens are not built yet are listed but inert, like the main navigation.

export type SettingsSection = {
  label: string;
  href: string;
  description: string;
  anyOf: readonly string[];
  built: boolean;
};

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    label: 'Organisation',
    href: '/settings/organisation',
    description: 'Legal name, address, tax numbers, timezone and logo',
    anyOf: ['settings.manage'],
    built: true,
  },
  {
    label: 'Billing',
    href: '/settings/billing',
    description: 'Bank accounts, VAT, payment terms, late fees and document numbers',
    anyOf: ['settings.billing.sensitive'],
    built: true,
  },
  {
    label: 'Pipeline',
    href: '/settings/pipeline',
    description: 'Deal stages, their win probabilities and lost reasons',
    anyOf: ['deals.manage'],
    built: true,
  },
  {
    label: 'Document templates',
    href: '/settings/document-templates',
    description: 'What quotes, proposals, contracts and the rest start from',
    anyOf: ['templates.documents.manage'],
    built: true,
  },
  {
    label: 'Clauses',
    href: '/settings/clauses',
    description: 'Wording shared across templates, versioned',
    anyOf: ['templates.documents.manage'],
    built: true,
  },
  {
    label: 'Roles and permissions',
    href: '/settings/roles',
    description: 'Default and custom roles',
    anyOf: ['roles.manage'],
    built: false,
  },
  {
    label: 'Business hours and holidays',
    href: '/settings/business-hours',
    description: 'Working hours and public holidays for SLA timers and time off',
    anyOf: ['settings.manage', 'sla.manage'],
    built: true,
  },
  {
    label: 'SLA policies',
    href: '/settings/sla',
    description: 'Response and resolution targets',
    anyOf: ['sla.manage'],
    built: false,
  },
  {
    label: 'Integrations',
    href: '/settings/integrations',
    description: 'Paystack, Resend, WhatsApp, Google and Turnstile',
    anyOf: ['integrations.manage'],
    built: false,
  },
  {
    label: 'Audit log',
    href: '/settings/audit',
    description: 'Every change, who made it and when',
    anyOf: ['audit.view'],
    built: false,
  },
];

export function settingsSectionsFor(permissions: readonly string[]): SettingsSection[] {
  const held = new Set(permissions);
  return SETTINGS_SECTIONS.filter((section) => section.anyOf.some((key) => held.has(key)));
}
