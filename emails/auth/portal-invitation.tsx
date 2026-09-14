import { Button, Link, Text } from 'react-email';
import { AuthEmailLayout, styles } from './layout';

export function PortalInvitationEmail({
  url,
  inviterName,
  clientName,
}: {
  url: string;
  inviterName: string;
  clientName: string;
}) {
  return (
    <AuthEmailLayout preview={`${inviterName} invited you to the Unbuilt client portal`}>
      <Text style={styles.heading}>Your Unbuilt client portal</Text>
      <Text style={styles.text}>
        {inviterName} at Unbuilt Studio gave you access to the client portal for {clientName}. There you can follow
        projects, review work, sign documents, pay invoices and ask for support.
      </Text>
      <Button href={url} style={styles.button}>
        Open the portal
      </Button>
      <Text style={{ ...styles.muted, margin: '24px 0 0' }}>
        Or paste this link into your browser:{' '}
        <Link href={url} style={{ color: '#000', wordBreak: 'break-all' }}>
          {url}
        </Link>
      </Text>
      <Text style={{ ...styles.muted, margin: '16px 0 0' }}>
        You sign in with this email address; there is no password. If you were not expecting this, you can ignore it.
      </Text>
    </AuthEmailLayout>
  );
}

PortalInvitationEmail.PreviewProps = {
  url: 'https://portal.unbuilt.studio/sign-in?email=ada%40glossup.com',
  inviterName: 'Kemi Bello',
  clientName: 'Glossup',
};

export default PortalInvitationEmail;
