import { Button, Link, Text } from 'react-email';
import { AuthEmailLayout, styles } from '../auth/layout';

// What a client receives when the studio sends a document (07-documents-and-esign.md, Send). The document itself is
// read in the portal, so the email carries the link rather than the PDF.

export function DocumentSentEmail({
  contactName,
  documentTitle,
  documentNumber,
  typeLabel,
  studioName,
  senderName,
  message,
  portalUrl,
  validUntil,
}: {
  contactName: string;
  documentTitle: string;
  documentNumber: string;
  typeLabel: string;
  studioName: string;
  senderName: string;
  message?: string;
  portalUrl: string;
  validUntil?: string;
}) {
  return (
    <AuthEmailLayout preview={`${typeLabel} ${documentNumber} from ${studioName}`}>
      <Text style={styles.heading}>
        {typeLabel}: {documentTitle}
      </Text>
      <Text style={styles.text}>
        {contactName}, {senderName} at {studioName} has sent you {typeLabel.toLowerCase()} {documentNumber}. You can
        read it in your portal and download the PDF there.
      </Text>
      {message && <Text style={styles.text}>{message}</Text>}
      <Button href={portalUrl} style={styles.button}>
        Open the {typeLabel.toLowerCase()}
      </Button>
      {validUntil && <Text style={{ ...styles.muted, margin: '24px 0 0' }}>It is open until {validUntil}.</Text>}
      <Text style={{ ...styles.muted, margin: '16px 0 0' }}>
        Or paste this link into your browser:{' '}
        <Link href={portalUrl} style={{ color: '#000', wordBreak: 'break-all' }}>
          {portalUrl}
        </Link>
      </Text>
    </AuthEmailLayout>
  );
}

DocumentSentEmail.PreviewProps = {
  contactName: 'Ada',
  documentTitle: 'Glossup app, phase one',
  documentNumber: 'UNB-QUO-0007',
  typeLabel: 'Quote',
  studioName: 'Unbuilt Studio',
  senderName: 'Kemi Bello',
  message: 'Happy to walk through this on a call if that is easier.',
  portalUrl: 'https://portal.unbuilt.studio/documents/abc123',
  validUntil: '21 October 2026',
};
