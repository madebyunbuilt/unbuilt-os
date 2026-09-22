import { Button, Link, Text } from 'react-email';
import { AuthEmailLayout, styles } from '../auth/layout';

// A signer's link (07-documents-and-esign.md, The signing ceremony). The link is theirs alone; the page asks for a code
// sent to this address before anything can be signed. The same email carries reminders.

export type SigningRequestReason = 'invitation' | 'resend' | 'reminder' | 'final_reminder';

const OPENERS: Record<SigningRequestReason, (typeLabel: string, studioName: string) => string> = {
  invitation: (typeLabel, studioName) => `${studioName} has asked you to sign ${typeLabel.toLowerCase()}`,
  resend: (typeLabel, studioName) => `${studioName} has sent you a new link to sign ${typeLabel.toLowerCase()}`,
  reminder: (typeLabel) => `A reminder that ${typeLabel.toLowerCase()} is waiting for your signature`,
  final_reminder: (typeLabel) => `${typeLabel} is still waiting for your signature, and the link expires tomorrow`,
};

export function SigningRequestEmail({
  reason,
  signerName,
  documentTitle,
  documentNumber,
  typeLabel,
  studioName,
  signingUrl,
  expiresOn,
}: {
  reason: SigningRequestReason;
  signerName: string;
  documentTitle: string;
  documentNumber: string;
  typeLabel: string;
  studioName: string;
  signingUrl: string;
  expiresOn: string;
}) {
  return (
    <AuthEmailLayout preview={`Please sign ${typeLabel.toLowerCase()} ${documentNumber}`}>
      <Text style={styles.heading}>
        {typeLabel}: {documentTitle}
      </Text>
      <Text style={styles.text}>
        {signerName}, {OPENERS[reason](typeLabel, studioName)} {documentNumber}. You can read it in full before you
        sign, and we will email you a code to confirm it is you.
      </Text>
      {reason !== 'invitation' && (
        <Text style={styles.text}>Use this link: any earlier one we sent you for this document no longer works.</Text>
      )}
      <Button href={signingUrl} style={styles.button}>
        Review and sign
      </Button>
      <Text style={{ ...styles.muted, margin: '24px 0 0' }}>
        This link is for you alone and works until {expiresOn}. Please do not forward it.
      </Text>
      <Text style={{ ...styles.muted, margin: '16px 0 0' }}>
        Or paste this link into your browser:{' '}
        <Link href={signingUrl} style={{ color: '#000', wordBreak: 'break-all' }}>
          {signingUrl}
        </Link>
      </Text>
    </AuthEmailLayout>
  );
}

SigningRequestEmail.PreviewProps = {
  reason: 'invitation',
  signerName: 'Ada',
  documentTitle: 'Glossup app, phase one',
  documentNumber: 'UNB-SOW-0003',
  typeLabel: 'Statement of work',
  studioName: 'Unbuilt Studio',
  signingUrl: 'https://portal.unbuilt.studio/sign/abc123',
  expiresOn: '6 October 2026',
} satisfies Parameters<typeof SigningRequestEmail>[0];

export default SigningRequestEmail;
