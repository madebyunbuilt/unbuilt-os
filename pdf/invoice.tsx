import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { type Currency, formatBpsAsPercent, formatMoneyWithCode } from '@/convex/lib/money';
import { type InvoicePdfPayload, type PdfLineItem } from './types';

export type { InvoicePdfPayload } from './types';

// The invoice a client receives (08-billing-and-finance.md, Invoices). Totals arrive already worked out by
// convex/lib/money.ts; this only lays them out. Amounts print with the currency code, since the standard PDF fonts have
// no ₦. WHT is informational: the total is not reduced, and a note shows the expected deduction.

const styles = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 48, fontSize: 10, color: '#111827', lineHeight: 1.5 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  studio: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  headerRight: { textAlign: 'right' },
  muted: { color: '#6B7280' },
  bold: { fontFamily: 'Helvetica-Bold' },
  title: { fontSize: 20, fontFamily: 'Helvetica-Bold', lineHeight: 1.5, marginBottom: 12 },
  facts: { flexDirection: 'row', gap: 32, marginBottom: 20 },
  fact: { minWidth: 90 },
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
  table: { marginTop: 4, marginBottom: 8 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F3F4F6', paddingVertical: 5 },
  headRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#111827', paddingBottom: 4 },
  cellDescription: { flex: 4, paddingRight: 8 },
  cellNumber: { flex: 1.3, textAlign: 'right' },
  totalsBlock: { marginTop: 10, marginLeft: 'auto', width: '55%' },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  totalsTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 6,
    marginTop: 4,
    borderTopWidth: 1,
  },
  note: { marginTop: 4, color: '#374151' },
  section: { marginTop: 20 },
  h3: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  accounts: { flexDirection: 'row', flexWrap: 'wrap', gap: 24 },
  account: { minWidth: 200 },
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
  watermark: {
    position: 'absolute',
    top: '45%',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 72,
    fontFamily: 'Helvetica-Bold',
    color: '#EF4444',
    opacity: 0.18,
  },
});

const quantity = (quantityMilli: number) => {
  const value = quantityMilli / 1000;
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '');
};

const TREATMENT: Record<InvoicePdfPayload['vatTreatment'], string> = {
  standard: 'No VAT charged',
  zero_rated: 'VAT: zero-rated',
  exempt: 'VAT: exempt',
};

function Lines({ items, currency }: { items: PdfLineItem[]; currency: Currency }) {
  const anyUntaxed = items.some((item) => !item.taxable);
  return (
    <View style={styles.table}>
      <View style={styles.headRow} fixed>
        <Text style={[styles.cellDescription, styles.bold]}>Description</Text>
        <Text style={[styles.cellNumber, styles.bold]}>Qty</Text>
        <Text style={[styles.cellNumber, styles.bold]}>Unit price</Text>
        <Text style={[styles.cellNumber, styles.bold]}>Amount</Text>
      </View>
      {items.map((item, index) => (
        <View key={index} style={styles.row} wrap={false}>
          <Text style={styles.cellDescription}>
            {item.description}
            {anyUntaxed && !item.taxable ? ' (no VAT)' : ''}
          </Text>
          <Text style={styles.cellNumber}>{quantity(item.quantityMilli)}</Text>
          <Text style={styles.cellNumber}>{formatMoneyWithCode(item.unitPriceMinor, currency)}</Text>
          <Text style={styles.cellNumber}>{formatMoneyWithCode(item.amountMinor, currency)}</Text>
        </View>
      ))}
    </View>
  );
}

function Totals({ payload }: { payload: InvoicePdfPayload }) {
  const { totals, currency, vat, wht, vatTreatment } = payload;
  const money = (amount: number) => formatMoneyWithCode(amount, currency);
  return (
    <View style={styles.totalsBlock} wrap={false}>
      <View style={styles.totalsRow}>
        <Text style={styles.muted}>Subtotal</Text>
        <Text>{money(totals.subtotalMinor)}</Text>
      </View>
      {totals.discountMinor > 0 && (
        <View style={styles.totalsRow}>
          <Text style={styles.muted}>Discount</Text>
          {/* A plain hyphen: the standard PDF fonts have no minus sign. */}
          <Text>-{money(totals.discountMinor)}</Text>
        </View>
      )}
      <View style={styles.totalsRow}>
        <Text style={styles.muted}>
          {vat.applies ? `VAT at ${formatBpsAsPercent(vat.bps)}%` : TREATMENT[vatTreatment]}
        </Text>
        <Text>{vat.applies ? money(totals.vatMinor) : '—'}</Text>
      </View>
      <View style={styles.totalsTotal}>
        <Text style={styles.bold}>Total due</Text>
        <Text style={styles.bold}>{money(totals.totalMinor)}</Text>
      </View>
      {wht.applies && totals.whtExpectedMinor > 0 && (
        <Text style={[styles.note, { fontSize: 9 }]}>
          If you deduct withholding tax at {formatBpsAsPercent(wht.bps)}% ({money(totals.whtExpectedMinor)}), pay{' '}
          {money(totals.totalMinor - totals.whtExpectedMinor)} and send us the WHT certificate.
        </Text>
      )}
    </View>
  );
}

export function InvoicePdf(payload: InvoicePdfPayload) {
  const { org, client, number, typeLabel, currency, brand } = payload;
  const created = new Date(payload.createdAtMs);
  return (
    <Document
      title={`${typeLabel} ${number}`}
      author={org.name}
      subject={`${typeLabel} ${number} for ${client.name}`}
      creator={org.name}
      producer="Unbuilt OS"
      creationDate={created}
      modificationDate={created}
    >
      <Page size="A4" style={styles.page}>
        {payload.voided && (
          <Text style={styles.watermark} fixed>
            Void
          </Text>
        )}
        <View style={styles.header} fixed>
          <View>
            <Text style={[styles.studio, { color: brand.primary }]}>{org.name}</Text>
            {org.addressLines.length > 0 && <Text style={styles.muted}>{org.addressLines.join(', ')}</Text>}
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.bold}>{typeLabel}</Text>
            <Text style={styles.muted}>{number}</Text>
          </View>
        </View>

        <Text style={styles.title}>
          {typeLabel} {number}
        </Text>
        <View style={styles.facts}>
          <View style={styles.fact}>
            <Text style={styles.label}>Issued</Text>
            <Text>{payload.issueDate}</Text>
          </View>
          <View style={styles.fact}>
            <Text style={styles.label}>Due</Text>
            <Text style={styles.bold}>{payload.dueDate}</Text>
          </View>
          <View style={styles.fact}>
            <Text style={styles.label}>Amount due</Text>
            <Text style={styles.bold}>{formatMoneyWithCode(payload.totals.totalMinor, currency)}</Text>
          </View>
        </View>

        <View style={styles.parties}>
          <View style={styles.party}>
            <Text style={styles.label}>Bill to</Text>
            <Text style={styles.bold}>{client.name}</Text>
            {client.addressLines.map((line, index) => (
              <Text key={index} style={styles.muted}>
                {line}
              </Text>
            ))}
            {client.tin && <Text style={styles.muted}>TIN {client.tin}</Text>}
          </View>
          <View style={styles.party}>
            <Text style={styles.label}>From</Text>
            <Text style={styles.bold}>{org.name}</Text>
            {[org.email, org.phone, org.website, org.tin && `TIN ${org.tin}`, org.vatNumber && `VAT ${org.vatNumber}`]
              .filter(Boolean)
              .map((line, index) => (
                <Text key={index} style={styles.muted}>
                  {line}
                </Text>
              ))}
          </View>
        </View>

        <Lines items={payload.lineItems} currency={currency} />
        <Totals payload={payload} />

        {payload.bankAccounts.length > 0 && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.h3}>How to pay</Text>
            <Text style={[styles.muted, { marginBottom: 6 }]}>
              Please pay by bank transfer, quoting {number} as the reference.
            </Text>
            <View style={styles.accounts}>
              {payload.bankAccounts.map((account, index) => (
                <View key={index} style={styles.account}>
                  <Text style={styles.bold}>{account.bankName}</Text>
                  <Text>{account.accountName}</Text>
                  <Text>Account {account.accountNumber}</Text>
                  {account.swift && <Text style={styles.muted}>SWIFT {account.swift}</Text>}
                  {account.iban && <Text style={styles.muted}>IBAN {account.iban}</Text>}
                </View>
              ))}
            </View>
          </View>
        )}

        {payload.notes && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.h3}>Notes</Text>
            <Text>{payload.notes}</Text>
          </View>
        )}
        {payload.terms && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.h3}>Terms</Text>
            <Text>{payload.terms}</Text>
          </View>
        )}
        {payload.footer && <Text style={[styles.section, styles.muted]}>{payload.footer}</Text>}

        <View style={styles.footer} fixed>
          <Text style={styles.muted}>
            {typeLabel} {number} · due {payload.dueDate}
          </Text>
          <Text style={styles.muted} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
