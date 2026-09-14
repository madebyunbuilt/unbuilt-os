import { Button, Link, Text } from 'react-email';
import { AuthEmailLayout, styles } from './layout';

export function InvitationEmail({
  url,
  inviterName,
  roleName,
  expiresOn,
}: {
  url: string;
  inviterName: string;
  roleName: string;
  expiresOn: string;
}) {
  return (
    <AuthEmailLayout preview={`${inviterName} invited you to Unbuilt OS`}>
      <Text style={styles.heading}>You are invited to Unbuilt OS</Text>
      <Text style={styles.text}>
        {inviterName} invited you to join the studio’s workspace as {roleName}. Accept to sign in with this email
        address and set up two-factor authentication on your phone.
      </Text>
      <Button href={url} style={styles.button}>
        Accept invitation
      </Button>
      <Text style={{ ...styles.muted, margin: '24px 0 0' }}>
        Or paste this link into your browser:{' '}
        <Link href={url} style={{ color: '#000', wordBreak: 'break-all' }}>
          {url}
        </Link>
      </Text>
      <Text style={{ ...styles.muted, margin: '16px 0 0' }}>
        The invitation expires on {expiresOn}. If you were not expecting it, you can ignore this email.
      </Text>
    </AuthEmailLayout>
  );
}

InvitationEmail.PreviewProps = {
  url: 'https://os.unbuilt.studio/sign-in?email=dayo%40unbuilt.studio',
  inviterName: 'Unbuilt Studio',
  roleName: 'Project manager',
  expiresOn: '28 September 2026',
};

export default InvitationEmail;
