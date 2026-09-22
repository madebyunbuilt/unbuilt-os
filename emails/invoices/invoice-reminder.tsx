import { Text } from 'react-email';
import { AuthEmailLayout, styles } from '../auth/layout';

// A payment reminder to the billing contacts (08-billing-and-finance.md, Reminders). It says what is still owed and
// when it was or is due, with the invoice attached again.

const OPENERS = {
  soon: (number: string, dueDate: string) => `a reminder that invoice ${number} is due on ${dueDate}.`,
  today: (number: string) => `invoice ${number} is due today.`,
  late: (number: string, dueDate: string) => `invoice ${number} was due on ${dueDate} and is still outstanding.`,
} as const;

export function InvoiceReminderEmail({
  contactName,
  number,
  studioName,
  balance,
  dueDate,
  wording,
}: {
  contactName: string;
  number: string;
  studioName: string;
  balance: string;
  dueDate: string;
  wording: keyof typeof OPENERS;
}) {
  return (
    <AuthEmailLayout preview={`Invoice ${number}: ${balance} ${wording === 'late' ? 'overdue' : 'due'}`}>
      <Text style={styles.heading}>
        {wording === 'late' ? 'Overdue' : 'Payment due'}: {number}
      </Text>
      <Text style={styles.text}>
        {contactName}, {OPENERS[wording](number, dueDate)} The amount still owed is {balance}. The invoice is attached
        again, with the bank details to pay into.
      </Text>
      <Text style={{ ...styles.muted, margin: '24px 0 0' }}>
        If you have already paid, thank you, and please reply with the reference so {studioName} can match it.
      </Text>
    </AuthEmailLayout>
  );
}

InvoiceReminderEmail.PreviewProps = {
  contactName: 'Ada',
  number: 'UNB-INV-0010',
  studioName: 'Unbuilt Studio',
  balance: '₦40,000.00',
  dueDate: '22 October 2026',
  wording: 'late',
} satisfies Parameters<typeof InvoiceReminderEmail>[0];

export default InvoiceReminderEmail;
