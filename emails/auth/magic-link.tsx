import { Button, Link, Text } from 'react-email';
import { AuthEmailLayout, styles } from './layout';

export function MagicLinkEmail({ url }: { url: string }) {
  return (
    <AuthEmailLayout preview="Your sign-in link for Unbuilt OS">
      <Text style={styles.heading}>Sign in to Unbuilt OS</Text>
      <Text style={styles.text}>Use the button below to sign in. The link works once and expires in 15 minutes.</Text>
      <Button href={url} style={styles.button}>
        Sign in
      </Button>
      <Text style={{ ...styles.muted, margin: '24px 0 0' }}>
        Or paste this link into your browser:{' '}
        <Link href={url} style={{ color: '#000', wordBreak: 'break-all' }}>
          {url}
        </Link>
      </Text>
      <Text style={{ ...styles.muted, margin: '16px 0 0' }}>
        If you did not ask for this, you can ignore this email.
      </Text>
    </AuthEmailLayout>
  );
}

MagicLinkEmail.PreviewProps = { url: 'https://os.unbuilt.studio/api/auth/magic-link/verify?token=preview' };

export default MagicLinkEmail;
