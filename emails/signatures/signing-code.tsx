import { Text } from 'react-email';
import { AuthEmailLayout, styles } from '../auth/layout';

// The code that confirms a signer controls their address (07-documents-and-esign.md, The signing ceremony).

export function SigningCodeEmail({ code, documentNumber }: { code: string; documentNumber: string }) {
  return (
    <AuthEmailLayout preview={`${code} is your code to sign ${documentNumber}`}>
      <Text style={styles.heading}>Your signing code</Text>
      <Text style={styles.text}>
        Enter this code on the signing page for {documentNumber}. It works for 10 minutes.
      </Text>
      <Text
        style={{
          ...styles.heading,
          fontFamily: "'Anybody', 'Courier New', monospace",
          fontSize: '32px',
          letterSpacing: '0.2em',
          margin: '8px 0 24px',
        }}
      >
        {code}
      </Text>
      <Text style={styles.muted}>
        If you did not ask for this, ignore this email. Nobody can sign without both the code and your own link.
      </Text>
    </AuthEmailLayout>
  );
}

SigningCodeEmail.PreviewProps = { code: '482913', documentNumber: 'UNB-SOW-0003' };

export default SigningCodeEmail;
