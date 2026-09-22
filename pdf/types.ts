import { type DocumentBlock } from '@/convex/lib/documentBlocks';
import { type Currency } from '@/convex/lib/money';

// What the PDF needs, on its own so the Convex action can name it without pulling the renderer's types into the API.

export type PdfLineItem = {
  description: string;
  quantityMilli: number;
  unitPriceMinor: number;
  amountMinor: number;
  taxable: boolean;
};

export type PdfTotals = {
  subtotalMinor: number;
  discountMinor: number;
  taxableMinor: number;
  vatMinor: number;
  totalMinor: number;
  whtExpectedMinor: number;
};

export type PdfMilestone = { name: string; dueDate?: string; amount?: string };

export type DocumentPdfProps = {
  blocks: DocumentBlock[];
  title: string;
  typeLabel: string;
  number?: string;
  /** The studio, for the header and the closing details. */
  org: { name: string; addressLines: string[]; email?: string; phone?: string; website?: string; tin?: string };
  client: { name: string; addressLines: string[] };
  currency: Currency;
  lineItems?: PdfLineItem[];
  totals?: PdfTotals;
  milestones?: PdfMilestone[];
  paymentSchedule?: { label: string; amount?: string }[];
  /** Watermarked across every page when the document is void. */
  voided?: boolean;
  brand: { primary: string; accent: string };
  /** Fixed so the same version always renders to the same bytes. */
  createdAt: Date;
  /** On the signed copy only: who signed for each side, drawn onto the signature lines. */
  signatures?: Partial<Record<'client' | 'studio', SignatureMark[]>>;
};

export type SignatureMark = {
  name: string;
  typedName?: string;
  /** A drawn signature as a PNG data URI. */
  imageDataUri?: string;
  signedAt: number;
};

/** The payload a Convex action hands the renderer: the props, with the date as a number so it survives the wire. */
export type DocumentPdfPayload = Omit<DocumentPdfProps, 'createdAt'> & { createdAtMs: number };

export type CertificateSigner = {
  name: string;
  email: string;
  /** "Client" or "The studio". */
  role: string;
  method: 'typed' | 'drawn';
  typedName?: string;
  /** A drawn signature as a PNG data URI. */
  imageDataUri?: string;
  verification: 'email_code' | 'app_session';
  otpVerifiedAt: number;
  signedAt: number;
  ip?: string;
  userAgent?: string;
  consentText: string;
  consentVersion: number;
};

export type CertificatePdfProps = {
  org: { name: string };
  brand: { primary: string };
  typeLabel: string;
  number: string;
  title: string;
  documentSha256: string;
  signers: CertificateSigner[];
  /** Also the PDF's creation date, so the same completion renders the same bytes. */
  completedAt: number;
  /** The signatures are also drawn on the document's own signature lines, before this page. */
  signaturesInPlace?: boolean;
};
