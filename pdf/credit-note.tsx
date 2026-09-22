import { Text, View } from '@react-pdf/renderer';
import { formatBpsAsPercent, formatMoneyWithCode } from '@/convex/lib/money';
import { FinanceSlip, Row, slip } from './finance-slip';
import { type CreditNotePdfPayload } from './types';

// A credit note (08-billing-and-finance.md, Credit notes). It says what was credited and why, the VAT reversed with
// it, and where the credit went: against the invoice, and any rest held for the client.

export function CreditNotePdf(payload: CreditNotePdfPayload) {
  const money = (amount: number) => formatMoneyWithCode(amount, payload.currency);
  return (
    <FinanceSlip
      kind="Credit note"
      number={payload.number}
      date={payload.date}
      parties={payload}
      createdAtMs={payload.createdAtMs}
    >
      <Text>Against invoice {payload.invoiceNumber}.</Text>
      <Text style={[slip.muted, { marginBottom: 8 }]}>Reason: {payload.reason}</Text>
      {payload.lineItems.map((line, index) => (
        <View key={index} style={slip.row}>
          <Text>{line.description}</Text>
          <Text>{money(line.amountMinor)}</Text>
        </View>
      ))}
      <View style={slip.rows}>
        <Row label="Credit before VAT" value={money(payload.netMinor)} />
        {payload.vatMinor > 0 && (
          <Row label={`VAT reversed at ${formatBpsAsPercent(payload.vatBps)}%`} value={money(payload.vatMinor)} />
        )}
        <Row label="Total credit" value={money(payload.amountMinor)} strong />
        <Row label={`Applied to ${payload.invoiceNumber}`} value={money(payload.appliedToInvoiceMinor)} />
        {payload.heldMinor > 0 && <Row label="Held as your credit" value={money(payload.heldMinor)} />}
      </View>
      {payload.heldMinor > 0 && (
        <Text style={[slip.section, slip.muted]}>
          The {money(payload.heldMinor)} held as your credit can go towards a later invoice, or be paid back to you.
        </Text>
      )}
    </FinanceSlip>
  );
}
