import { Body, Container, Head, Hr, Html, Preview, Section, Text } from 'react-email';
import { type ReactNode } from 'react';

// Shared frame for sign-in emails: ink on paper, the wordmark set in type so it survives clients that block images.

const font = "'Instrument Sans', 'Helvetica Neue', Arial, sans-serif";

export const styles = {
  heading: {
    fontFamily: font,
    fontSize: '22px',
    fontWeight: 700,
    lineHeight: '28px',
    margin: '0 0 16px',
    color: '#000',
  },
  text: { fontFamily: font, fontSize: '15px', lineHeight: '24px', margin: '0 0 16px', color: '#000' },
  muted: { fontFamily: font, fontSize: '13px', lineHeight: '20px', margin: '0', color: '#595959' },
  button: {
    fontFamily: font,
    fontSize: '15px',
    fontWeight: 600,
    backgroundColor: '#000',
    color: '#fff',
    padding: '12px 20px',
    borderRadius: '4px',
    textDecoration: 'none',
    display: 'inline-block',
  },
} as const;

export function AuthEmailLayout({ preview, children }: { preview: string; children: ReactNode }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: '#fff', margin: 0, padding: '32px 16px' }}>
        <Container style={{ maxWidth: '480px', margin: '0 auto' }}>
          <Text
            style={{
              fontFamily: "'Anybody', 'Arial Black', Arial, sans-serif",
              fontSize: '20px',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              margin: '0 0 32px',
              color: '#000',
            }}
          >
            unbuilt
          </Text>
          <Section>{children}</Section>
          <Hr style={{ borderColor: 'rgba(0,0,0,0.16)', margin: '32px 0 16px' }} />
          <Text style={styles.muted}>
            Unbuilt OS. You received this because someone tried to sign in with this address.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
