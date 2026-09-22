import { Text } from 'react-email';
import { AuthEmailLayout, styles } from '../auth/layout';

// A receipt or credit note, sent to the client's billing contacts with the PDF attached (08-billing-and-finance.md).

export function FinanceDocumentEmail({
  contactName,
  kind,
  number,
  studioName,
  summary,
}: {
  contactName: string;
  kind: 'Receipt' | 'Credit note';
  number: string;
  studioName: string;
  summary: string;
}) {
  return (
    <AuthEmailLayout preview={`${kind} ${number} from ${studioName}`}>
      <Text style={styles.heading}>
        {kind} {number}
      </Text>
      <Text style={styles.text}>
        {contactName}, {summary} The {kind.toLowerCase()} is attached as a PDF for your records.
      </Text>
      <Text style={{ ...styles.muted, margin: '24px 0 0' }}>From {studioName}.</Text>
    </AuthEmailLayout>
  );
}

FinanceDocumentEmail.PreviewProps = {
  contactName: 'Ada',
  kind: 'Receipt',
  number: 'UNB-RCT-0004',
  studioName: 'Unbuilt Studio',
  summary: 'thank you for your payment of ₦600,000.00 against invoice UNB-INV-0010.',
} satisfies Parameters<typeof FinanceDocumentEmail>[0];

export default FinanceDocumentEmail;
