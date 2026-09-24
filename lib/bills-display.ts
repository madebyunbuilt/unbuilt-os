import { type StatusTone } from '@/lib/team-display';

// How bills are shown (08-billing-and-finance.md, Vendors and bills), in the words the studio would use.

export type BillStatus = 'draft' | 'approved' | 'scheduled' | 'paid' | 'void';

export const BILL_STATUSES: BillStatus[] = ['draft', 'approved', 'scheduled', 'paid', 'void'];

export function billStatus(status: BillStatus): { label: string; tone: StatusTone } {
  switch (status) {
    case 'draft':
      return { label: 'Draft', tone: 'draft' };
    case 'approved':
      return { label: 'Approved to pay', tone: 'draft' };
    case 'scheduled':
      return { label: 'Scheduled', tone: 'draft' };
    case 'paid':
      return { label: 'Paid', tone: 'built' };
    case 'void':
      return { label: 'Void', tone: 'muted' };
  }
}

export const VENDOR_KINDS = [
  { value: 'contractor', label: 'Contractor' },
  { value: 'supplier', label: 'Supplier' },
] as const;
