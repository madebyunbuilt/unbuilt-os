import { Text } from 'react-email';
import { AuthEmailLayout, styles } from '../auth/layout';

// What a client receives when the studio sends an invoice (08-billing-and-finance.md, Invoices). The PDF is attached,
// with the bank details to pay into; a pay link joins it once online payments arrive.

export function InvoiceSentEmail({
  contactName,
  number,
  typeLabel,
  studioName,
  senderName,
  amount,
  dueDate,
  message,
}: {
  contactName: string;
  number: string;
  typeLabel: string;
  studioName: string;
  senderName: string;
  amount: string;
  dueDate: string;
  message?: string;
}) {
  return (
    <AuthEmailLayout preview={`${typeLabel} ${number} from ${studioName}: ${amount}, due ${dueDate}`}>
      <Text style={styles.heading}>
        {typeLabel} {number}
      </Text>
      <Text style={styles.text}>
        {contactName}, {senderName} at {studioName} has sent you {typeLabel.toLowerCase()} {number} for {amount}, due on{' '}
        {dueDate}. It is attached as a PDF, with the bank details to pay into.
      </Text>
      {message && <Text style={styles.text}>{message}</Text>}
      <Text style={{ ...styles.muted, margin: '24px 0 0' }}>
        Please quote {number} as the reference when you pay. If you deduct withholding tax, send us the WHT credit note
        so we can match it to the invoice.
      </Text>
    </AuthEmailLayout>
  );
}

InvoiceSentEmail.PreviewProps = {
  contactName: 'Ada',
  number: 'UNB-INV-0007',
  typeLabel: 'Invoice',
  studioName: 'Unbuilt Studio',
  senderName: 'Kemi Bello',
  amount: '₦1,075,000.00',
  dueDate: '6 October 2026',
  message: 'Thanks again for the kick-off.',
} satisfies Parameters<typeof InvoiceSentEmail>[0];

export default InvoiceSentEmail;
