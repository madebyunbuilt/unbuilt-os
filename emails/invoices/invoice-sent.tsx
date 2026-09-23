import { Button, Link, Text } from 'react-email';
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
  whtNote,
  payUrl,
  bankAccounts,
}: {
  contactName: string;
  number: string;
  typeLabel: string;
  studioName: string;
  senderName: string;
  amount: string;
  dueDate: string;
  message?: string;
  /** Only for a client who withholds tax: the rate and amount, in their words. */
  whtNote?: string;
  /** The pay page: card where the studio takes cards, and the bank details either way. */
  payUrl?: string;
  /** The studio's accounts in the invoice's currency, so they can pay without opening the PDF. */
  bankAccounts: { bankName: string; accountName: string; accountNumber: string; swift?: string; iban?: string }[];
}) {
  return (
    <AuthEmailLayout preview={`${typeLabel} ${number} from ${studioName}: ${amount}, due ${dueDate}`}>
      <Text style={styles.heading}>
        {typeLabel} {number}
      </Text>
      <Text style={styles.text}>
        {contactName}, {senderName} at {studioName} has sent you {typeLabel.toLowerCase()} {number} for {amount}, due on{' '}
        {dueDate}. It is attached as a PDF.
      </Text>
      {message && <Text style={styles.text}>{message}</Text>}
      {payUrl && (
        <>
          <Button href={payUrl} style={styles.button}>
            View and pay {number}
          </Button>
          <Text style={{ ...styles.muted, margin: '16px 0 0' }}>
            Or paste this link into your browser:{' '}
            <Link href={payUrl} style={{ color: '#000', wordBreak: 'break-all' }}>
              {payUrl}
            </Link>
          </Text>
        </>
      )}
      {bankAccounts.length > 0 && (
        <>
          <Text style={{ ...styles.text, margin: '24px 0 4px' }}>Pay by bank transfer to:</Text>
          {bankAccounts.map((account, index) => (
            <Text key={index} style={{ ...styles.text, margin: '0 0 8px' }}>
              {account.bankName}
              <br />
              {account.accountName}
              <br />
              Account {account.accountNumber}
              {account.swift && (
                <>
                  <br />
                  SWIFT {account.swift}
                </>
              )}
              {account.iban && (
                <>
                  <br />
                  IBAN {account.iban}
                </>
              )}
            </Text>
          ))}
        </>
      )}
      <Text style={{ ...styles.muted, margin: '24px 0 0' }}>
        Please quote {number} as the reference when you pay.{whtNote ? ` ${whtNote}` : ''}
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
  whtNote: 'If you withhold tax at 5% (₦50,000.00), please pay ₦1,025,000.00 and send us the WHT certificate.',
  payUrl: 'https://portal.unbuilt.studio/pay/abc123',
  bankAccounts: [{ bankName: 'GTBank', accountName: 'Unbuilt Studio Ltd', accountNumber: '0123456789' }],
} satisfies Parameters<typeof InvoiceSentEmail>[0];

export default InvoiceSentEmail;
