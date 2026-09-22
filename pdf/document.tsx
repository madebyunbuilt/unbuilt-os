import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { type DocumentBlock } from '@/convex/lib/documentBlocks';
import { type Currency, formatMoneyWithCode } from '@/convex/lib/money';
import { type DocumentPdfProps, type PdfLineItem, type PdfTotals } from './types';

export type { DocumentPdfProps, PdfLineItem, PdfMilestone, PdfTotals } from './types';

// The PDF a client receives (07-documents-and-esign.md, PDF rendering). Every page carries the studio's name and the
// document number in the header and "page x of y" in the footer. Only the blocks the document holds are drawn: the text
// is already resolved, so nothing here reads the database or fills variables.

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
  title: { fontSize: 20, fontFamily: 'Helvetica-Bold', marginBottom: 16 },
  parties: {
    flexDirection: 'row',
    gap: 32,
    marginBottom: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  party: { flex: 1 },
  partyLabel: { fontSize: 8, textTransform: 'uppercase', color: '#6B7280', marginBottom: 2 },
  h1: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginTop: 16, marginBottom: 6 },
  h2: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 4 },
  h3: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 10, marginBottom: 2 },
  paragraph: { marginBottom: 8 },
  table: { marginTop: 8, marginBottom: 8 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F3F4F6', paddingVertical: 5 },
  headRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#111827', paddingBottom: 4 },
  cellDescription: { flex: 4 },
  cellNumber: { flex: 1, textAlign: 'right' },
  bold: { fontFamily: 'Helvetica-Bold' },
  totalsBlock: { marginTop: 10, marginLeft: 'auto', width: '55%' },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  totalsTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 6,
    marginTop: 4,
    borderTopWidth: 1,
  },
  signatures: { flexDirection: 'row', gap: 32, marginTop: 24 },
  signature: { flex: 1 },
  signatureLine: { marginTop: 32, borderTopWidth: 1, borderTopColor: '#111827', paddingTop: 4 },
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
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
};

function LineItems({ items, currency, title }: { items: PdfLineItem[]; currency: Currency; title?: string }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.table} wrap={false}>
      {title && <Text style={styles.h3}>{title}</Text>}
      <View style={styles.headRow}>
        <Text style={[styles.cellDescription, styles.bold]}>Description</Text>
        <Text style={[styles.cellNumber, styles.bold]}>Qty</Text>
        <Text style={[styles.cellNumber, styles.bold]}>Unit</Text>
        <Text style={[styles.cellNumber, styles.bold]}>Amount</Text>
      </View>
      {items.map((item, index) => (
        <View key={index} style={styles.row}>
          <Text style={styles.cellDescription}>
            {item.description}
            {item.taxable ? '' : ' (no VAT)'}
          </Text>
          <Text style={styles.cellNumber}>{quantity(item.quantityMilli)}</Text>
          <Text style={styles.cellNumber}>{formatMoneyWithCode(item.unitPriceMinor, currency)}</Text>
          <Text style={styles.cellNumber}>{formatMoneyWithCode(item.amountMinor, currency)}</Text>
        </View>
      ))}
    </View>
  );
}

function Totals({ totals, currency }: { totals: PdfTotals; currency: Currency }) {
  const rows: [string, number][] = [
    ['Subtotal', totals.subtotalMinor],
    ...(totals.discountMinor > 0 ? ([['Discount', -totals.discountMinor]] as [string, number][]) : []),
    ...(totals.vatMinor > 0 ? ([['VAT', totals.vatMinor]] as [string, number][]) : []),
  ];
  return (
    <View style={styles.totalsBlock} wrap={false}>
      {rows.map(([label, amount]) => (
        <View key={label} style={styles.totalsRow}>
          <Text style={styles.muted}>{label}</Text>
          <Text>{formatMoneyWithCode(amount, currency)}</Text>
        </View>
      ))}
      <View style={styles.totalsTotal}>
        <Text style={styles.bold}>Total</Text>
        <Text style={styles.bold}>{formatMoneyWithCode(totals.totalMinor, currency)}</Text>
      </View>
      {totals.whtExpectedMinor > 0 && (
        <View style={styles.totalsRow}>
          <Text style={styles.muted}>Withholding tax to deduct</Text>
          <Text style={styles.muted}>{formatMoneyWithCode(totals.whtExpectedMinor, currency)}</Text>
        </View>
      )}
    </View>
  );
}

function Rows({ title, rows }: { title?: string; rows: { left: string; right?: string }[] }) {
  if (rows.length === 0) return null;
  return (
    <View style={styles.table}>
      {title && <Text style={styles.h3}>{title}</Text>}
      {rows.map((row, index) => (
        <View key={index} style={styles.row}>
          <Text style={styles.cellDescription}>{row.left}</Text>
          <Text style={styles.cellNumber}>{row.right ?? ''}</Text>
        </View>
      ))}
    </View>
  );
}

function Block({ block, props }: { block: DocumentBlock; props: DocumentPdfProps }) {
  switch (block.kind) {
    case 'heading': {
      const style =
        block.level === undefined || block.level <= 1 ? styles.h1 : block.level === 2 ? styles.h2 : styles.h3;
      return <Text style={style}>{block.text}</Text>;
    }
    case 'paragraph':
      return <Text style={styles.paragraph}>{block.text}</Text>;
    case 'lineItems':
      return <LineItems items={props.lineItems ?? []} currency={props.currency} title={block.title} />;
    case 'totals':
      return props.totals ? <Totals totals={props.totals} currency={props.currency} /> : null;
    case 'milestones':
      return (
        <Rows
          title={block.title}
          rows={(props.milestones ?? []).map((milestone) => ({
            left: milestone.dueDate ? `${milestone.name} — due ${milestone.dueDate}` : milestone.name,
            right: milestone.amount,
          }))}
        />
      );
    case 'paymentSchedule':
      return (
        <Rows
          title={block.title}
          rows={(props.paymentSchedule ?? []).map((item) => ({ left: item.label, right: item.amount }))}
        />
      );
    case 'signature':
      return (
        <View style={styles.signature}>
          <Text style={styles.partyLabel}>{block.party === 'client' ? 'For the client' : 'For the studio'}</Text>
          <View style={styles.signatureLine}>
            <Text style={styles.muted}>Name</Text>
          </View>
          <View style={styles.signatureLine}>
            <Text style={styles.muted}>Signature and date</Text>
          </View>
        </View>
      );
    case 'pageBreak':
      return <View break />;
    case 'image':
      // Images arrive with the file-backed blocks; the alt text keeps the document readable until then.
      return <Text style={[styles.paragraph, styles.muted]}>[{block.alt}]</Text>;
  }
}

/** Signature blocks sit side by side, so consecutive ones are drawn as one row. */
function groupSignatures(blocks: DocumentBlock[]): (DocumentBlock | DocumentBlock[])[] {
  const grouped: (DocumentBlock | DocumentBlock[])[] = [];
  for (const block of blocks) {
    const last = grouped.at(-1);
    if (block.kind === 'signature' && Array.isArray(last) && last[0].kind === 'signature') last.push(block);
    else if (block.kind === 'signature') grouped.push([block]);
    else grouped.push(block);
  }
  return grouped;
}

export function DocumentPdf(props: DocumentPdfProps) {
  const { org, client, title, typeLabel, number, brand, createdAt } = props;
  const reference = number ?? 'Draft';

  return (
    <Document
      title={`${typeLabel} ${reference}`}
      author={org.name}
      subject={title}
      creator={org.name}
      producer="Unbuilt OS"
      creationDate={createdAt}
      modificationDate={createdAt}
    >
      <Page size="A4" style={styles.page}>
        {props.voided && (
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
            <Text style={styles.muted}>{reference}</Text>
          </View>
        </View>

        <Text style={styles.title}>{title}</Text>
        <View style={styles.parties}>
          <View style={styles.party}>
            <Text style={styles.partyLabel}>Prepared for</Text>
            <Text style={styles.bold}>{client.name}</Text>
            {client.addressLines.map((line, index) => (
              <Text key={index} style={styles.muted}>
                {line}
              </Text>
            ))}
          </View>
          <View style={styles.party}>
            <Text style={styles.partyLabel}>From</Text>
            <Text style={styles.bold}>{org.name}</Text>
            {[org.email, org.phone, org.website, org.tin && `TIN ${org.tin}`].filter(Boolean).map((line, index) => (
              <Text key={index} style={styles.muted}>
                {line}
              </Text>
            ))}
          </View>
        </View>

        {groupSignatures(props.blocks).map((entry, index) =>
          Array.isArray(entry) ? (
            <View key={index} style={styles.signatures} wrap={false}>
              {entry.map((block, inner) => (
                <Block key={inner} block={block} props={props} />
              ))}
            </View>
          ) : (
            <Block key={index} block={entry} props={props} />
          ),
        )}

        <View style={styles.footer} fixed>
          <Text style={styles.muted}>
            {typeLabel} {reference}
          </Text>
          <Text style={styles.muted} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
