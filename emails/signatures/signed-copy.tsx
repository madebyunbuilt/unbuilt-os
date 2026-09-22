import { Text } from 'react-email';
import { AuthEmailLayout, styles } from '../auth/layout';

// Every signer's copy once everyone has signed (07-documents-and-esign.md, Completion). The signed PDF, with its
// certificate page, is attached.

export function SignedCopyEmail({
  signerName,
  documentTitle,
  documentNumber,
  typeLabel,
  studioName,
  sha256,
}: {
  signerName: string;
  documentTitle: string;
  documentNumber: string;
  typeLabel: string;
  studioName: string;
  sha256: string;
}) {
  return (
    <AuthEmailLayout preview={`${typeLabel} ${documentNumber} is signed`}>
      <Text style={styles.heading}>
        {typeLabel} {documentNumber} is signed
      </Text>
      <Text style={styles.text}>
        {signerName}, everyone has now signed {documentTitle} with {studioName}. Your copy is attached, with a
        certificate page recording each signature.
      </Text>
      <Text style={styles.muted}>
        Fingerprint of the signed file (SHA-256): <span style={{ wordBreak: 'break-all' }}>{sha256}</span>
      </Text>
    </AuthEmailLayout>
  );
}

SignedCopyEmail.PreviewProps = {
  signerName: 'Ada',
  documentTitle: 'Glossup app, phase one',
  documentNumber: 'UNB-SOW-0003',
  typeLabel: 'Statement of work',
  studioName: 'Unbuilt Studio',
  sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
};

export default SignedCopyEmail;
