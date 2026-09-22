import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { type CertificatePdfProps } from './types';

export type { CertificatePdfProps } from './types';

// The signature certificate (07-documents-and-esign.md, Completion). It is rendered on its own and appended to the
// signed PDF, so the pages the signers read stay byte for byte what they signed. It lists every signer with the evidence
// recorded, and the fingerprint of the document they signed.

const styles = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 48, fontSize: 9, color: '#111827', lineHeight: 1.45 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  studio: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  bold: { fontFamily: 'Helvetica-Bold' },
  muted: { color: '#6B7280' },
  // Larger text needs its own line height; the page's is sized for the body text.
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', lineHeight: 1.25, marginBottom: 8 },
  intro: { marginBottom: 14 },
  hash: { fontFamily: 'Courier', fontSize: 8 },
  signer: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 4, padding: 10, marginBottom: 10 },
  signerName: { fontSize: 11, fontFamily: 'Helvetica-Bold', lineHeight: 1.3, marginBottom: 6 },
  mark: { height: 40, marginBottom: 6 },
  typedMark: { fontSize: 16, fontFamily: 'Times-Italic', lineHeight: 1.3, marginBottom: 6 },
  row: { flexDirection: 'row', paddingVertical: 1 },
  label: { width: 120, color: '#6B7280' },
  value: { flex: 1 },
  consent: { marginTop: 8, color: '#374151' },
  // Anchored from the top: with a line height on the page, react-pdf drops a footer placed with `bottom`. Pages are
  // always A4 (841.89pt tall), so this sits 24pt above the bottom edge.
  footer: {
    position: 'absolute',
    top: 802,
    left: 48,
    right: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});

const stamp = (at: number) =>
  `${new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'long',
    timeStyle: 'medium',
    timeZone: 'UTC',
  }).format(at)} UTC`;

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export function CertificatePdf({
  org,
  typeLabel,
  number,
  title,
  documentSha256,
  signers,
  completedAt,
  brand,
}: CertificatePdfProps) {
  const created = new Date(completedAt);
  return (
    <Document
      title={`Signature certificate, ${typeLabel} ${number}`}
      author={org.name}
      creator={org.name}
      producer="Unbuilt OS"
      creationDate={created}
      modificationDate={created}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <Text style={[styles.studio, { color: brand.primary }]}>{org.name}</Text>
          <View style={{ textAlign: 'right' }}>
            <Text style={styles.bold}>{typeLabel}</Text>
            <Text style={styles.muted}>{number}</Text>
          </View>
        </View>

        <Text style={styles.title}>Signature certificate</Text>
        <View style={styles.intro}>
          <Text>
            {title} ({typeLabel} {number}) was signed electronically by everyone listed below. Completed{' '}
            {stamp(completedAt)}.
          </Text>
          <Text style={[styles.muted, { marginTop: 6 }]}>SHA-256 of the document every signer signed:</Text>
          <Text style={styles.hash}>{documentSha256}</Text>
        </View>

        {signers.map((signer, index) => (
          <View key={index} style={styles.signer} wrap={false}>
            <Text style={styles.signerName}>{signer.name}</Text>
            {signer.imageDataUri ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf images take no alt text.
              <Image src={signer.imageDataUri} style={styles.mark} />
            ) : (
              <Text style={styles.typedMark}>{signer.typedName}</Text>
            )}
            <Row label="Email" value={signer.email} />
            <Row label="Signing as" value={signer.role} />
            <Row label="Method" value={signer.method === 'drawn' ? 'Drawn signature' : 'Typed name'} />
            <Row
              label={signer.verification === 'email_code' ? 'Email code checked' : 'Two-factor sign-in'}
              value={stamp(signer.otpVerifiedAt)}
            />
            <Row label="Signed" value={stamp(signer.signedAt)} />
            <Row label="IP address" value={signer.ip} />
            <Row label="Browser" value={signer.userAgent} />
            <Text style={styles.consent}>
              Agreed (consent version {signer.consentVersion}): “{signer.consentText}”
            </Text>
          </View>
        ))}

        <View style={styles.footer} fixed>
          <Text style={styles.muted}>Signature certificate · {number}</Text>
          <Text style={styles.muted} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
