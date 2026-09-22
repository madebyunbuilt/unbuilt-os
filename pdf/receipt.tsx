import { Text } from '@react-pdf/renderer';
import { formatMoneyWithCode } from '@/convex/lib/money';
import { FinanceSlip, Row, slip } from './finance-slip';
import { type ReceiptPdfPayload } from './types';

// A receipt for one payment (08-billing-and-finance.md, Receipts). WHT the client withheld is shown with it, since it
// settles the invoice too.

export function ReceiptPdf(payload: ReceiptPdfPayload) {
  const money = (amount: number) => formatMoneyWithCode(amount, payload.currency);
  return (
    <FinanceSlip
      kind="Receipt"
      number={payload.number}
      date={payload.date}
      parties={payload}
      createdAtMs={payload.createdAtMs}
    >
      <Text>
        Received with thanks against invoice {payload.invoiceNumber} ({money(payload.invoiceTotalMinor)}).
      </Text>
      <Row label="Paid by" value={payload.method} />
      {payload.reference && <Row label="Reference" value={payload.reference} />}
      <Row label="Amount received" value={money(payload.amountMinor)} strong />
      {payload.whtDeductedMinor > 0 && <Row label="Withholding tax withheld" value={money(payload.whtDeductedMinor)} />}
      <Row label={`Still owed on ${payload.invoiceNumber}`} value={money(payload.balanceAfterMinor)} />
      {payload.whtDeductedMinor > 0 && (
        <Text style={[slip.section, slip.muted]}>
          Please send us the WHT credit note for {money(payload.whtDeductedMinor)} so we can match it to this payment.
        </Text>
      )}
    </FinanceSlip>
  );
}
