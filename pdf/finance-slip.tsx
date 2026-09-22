import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { type ReactNode } from 'react';
import { type FinanceParties } from './types';

// The frame the receipt and the credit note share: header, parties, footer. Amounts arrive already worked out by
// convex/lib/money.ts and are printed with the currency code, since the standard PDF fonts have no ₦.

export const slip = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 48, fontSize: 10, color: '#111827', lineHeight: 1.5 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  studio: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  muted: { color: '#6B7280' },
  bold: { fontFamily: 'Helvetica-Bold' },
  title: { fontSize: 20, fontFamily: 'Helvetica-Bold', lineHeight: 1.5, marginBottom: 12 },
  label: { fontSize: 8, lineHeight: 1.5, textTransform: 'uppercase', color: '#6B7280', marginBottom: 2 },
  parties: {
    flexDirection: 'row',
    gap: 32,
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  party: { flex: 1 },
  rows: { marginLeft: 'auto', width: '60%', marginTop: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  strong: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6, marginTop: 4, borderTopWidth: 1 },
  section: { marginTop: 20 },
  h3: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  // Anchored from the top: with a line height on the page, react-pdf drops a footer placed with `bottom`.
  footer: {
    position: 'absolute',
    top: 802,
    left: 48,
    right: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});

export function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={strong ? slip.strong : slip.row}>
      <Text style={strong ? slip.bold : slip.muted}>{label}</Text>
      <Text style={strong ? slip.bold : undefined}>{value}</Text>
    </View>
  );
}

export function FinanceSlip({
  kind,
  number,
  date,
  parties,
  createdAtMs,
  children,
}: {
  kind: string;
  number: string;
  date: string;
  parties: FinanceParties;
  createdAtMs: number;
  children: ReactNode;
}) {
  const { org, client, brand } = parties;
  const created = new Date(createdAtMs);
  return (
    <Document
      title={`${kind} ${number}`}
      author={org.name}
      creator={org.name}
      producer="Unbuilt OS"
      creationDate={created}
      modificationDate={created}
    >
      <Page size="A4" style={slip.page}>
        <View style={slip.header} fixed>
          <View>
            <Text style={[slip.studio, { color: brand.primary }]}>{org.name}</Text>
            {org.addressLines.length > 0 && <Text style={slip.muted}>{org.addressLines.join(', ')}</Text>}
          </View>
          <View style={{ textAlign: 'right' }}>
            <Text style={slip.bold}>{kind}</Text>
            <Text style={slip.muted}>{number}</Text>
          </View>
        </View>
        <Text style={slip.title}>
          {kind} {number}
        </Text>
        <Text style={[slip.muted, { marginBottom: 16 }]}>{date}</Text>
        <View style={slip.parties}>
          <View style={slip.party}>
            <Text style={slip.label}>For</Text>
            <Text style={slip.bold}>{client.name}</Text>
            {client.addressLines.map((line, index) => (
              <Text key={index} style={slip.muted}>
                {line}
              </Text>
            ))}
            {client.tin && <Text style={slip.muted}>TIN {client.tin}</Text>}
          </View>
          <View style={slip.party}>
            <Text style={slip.label}>From</Text>
            <Text style={slip.bold}>{org.name}</Text>
            {[org.email, org.tin && `TIN ${org.tin}`, org.vatNumber && `VAT ${org.vatNumber}`]
              .filter(Boolean)
              .map((line, index) => (
                <Text key={index} style={slip.muted}>
                  {line}
                </Text>
              ))}
          </View>
        </View>
        {children}
        <View style={slip.footer} fixed>
          <Text style={slip.muted}>
            {kind} {number}
          </Text>
          <Text style={slip.muted} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
