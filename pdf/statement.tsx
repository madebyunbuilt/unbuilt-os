import { Text, View } from '@react-pdf/renderer';
import { formatMoneyWithCode } from '@/convex/lib/money';
import { FinanceSlip, slip } from './finance-slip';
import { type StatementPdfPayload } from './types';

// A statement of account (08-billing-and-finance.md, Statements): per currency, the opening balance, every line in the
// range with a running balance, and the closing balance. A balance below zero means the client is in credit.

const cell = {
  date: { width: 62 },
  description: { flex: 1, paddingRight: 8 },
  amount: { width: 92, paddingLeft: 6, textAlign: 'right' as const },
};
const table = { fontSize: 8.5 };

/** "2026-09-15" as "15 Sep 2026". */
const day = (value: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    Date.parse(`${value}T00:00:00Z`),
  );

export function StatementPdf(payload: StatementPdfPayload) {
  return (
    <FinanceSlip
      kind="Statement"
      number={`${day(payload.fromDate)} to ${day(payload.toDate)}`}
      date={`Prepared ${day(new Date(payload.createdAtMs).toISOString().slice(0, 10))}`}
      parties={payload}
      createdAtMs={payload.createdAtMs}
    >
      {payload.sections.length === 0 && <Text style={slip.muted}>Nothing on the account in this period.</Text>}
      {payload.sections.map((section) => {
        const money = (amount: number) =>
          amount < 0
            ? `${formatMoneyWithCode(-amount, section.currency)} CR`
            : formatMoneyWithCode(amount, section.currency);
        const inCredit =
          section.openingMinor < 0 || section.closingMinor < 0 || section.lines.some((line) => line.balanceMinor < 0);
        return (
          <View key={section.currency} style={[{ marginBottom: 20 }, table]}>
            <Text style={slip.h3}>{section.currency}</Text>
            <View style={[slip.row, { borderBottomWidth: 1, borderBottomColor: '#111827' }]} fixed>
              <Text style={[cell.date, slip.bold]}>Date</Text>
              <Text style={[cell.description, slip.bold]}>Details</Text>
              <Text style={[cell.amount, slip.bold]}>Charged</Text>
              <Text style={[cell.amount, slip.bold]}>Paid or credited</Text>
              <Text style={[cell.amount, slip.bold]}>Balance</Text>
            </View>
            <View style={slip.row}>
              <Text style={cell.date}>{day(payload.fromDate)}</Text>
              <Text style={[cell.description, slip.muted]}>Opening balance</Text>
              <Text style={cell.amount} />
              <Text style={cell.amount} />
              <Text style={cell.amount}>{money(section.openingMinor)}</Text>
            </View>
            {section.lines.map((line, index) => (
              <View key={index} style={slip.row} wrap={false}>
                <Text style={cell.date}>{day(line.date)}</Text>
                <Text style={cell.description}>{line.description}</Text>
                <Text style={cell.amount}>
                  {line.debitMinor ? formatMoneyWithCode(line.debitMinor, section.currency) : ''}
                </Text>
                <Text style={cell.amount}>
                  {line.creditMinor ? formatMoneyWithCode(line.creditMinor, section.currency) : ''}
                </Text>
                <Text style={cell.amount}>{money(line.balanceMinor)}</Text>
              </View>
            ))}
            <View style={slip.strong}>
              <Text style={slip.bold}>Closing balance on {day(payload.toDate)}</Text>
              <Text style={slip.bold}>{money(section.closingMinor)}</Text>
            </View>
            {inCredit && <Text style={[slip.muted, { marginTop: 4 }]}>CR: in credit, money we hold for you.</Text>}
          </View>
        );
      })}
    </FinanceSlip>
  );
}
