import { Text } from 'react-email';
import { AuthEmailLayout, styles } from './layout';

export function SignInCodeEmail({ code }: { code: string }) {
  return (
    <AuthEmailLayout preview={`${code} is your Unbuilt OS sign-in code`}>
      <Text style={styles.heading}>Your sign-in code</Text>
      <Text style={styles.text}>Enter this code to finish signing in. It expires in 3 minutes.</Text>
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
        If you did not try to sign in, ignore this email. Nobody can sign in with the code without your sign-in link.
      </Text>
    </AuthEmailLayout>
  );
}

SignInCodeEmail.PreviewProps = { code: '482913' };

export default SignInCodeEmail;
