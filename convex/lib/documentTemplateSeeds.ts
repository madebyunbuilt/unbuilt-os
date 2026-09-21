import { type DocumentBlock, type DocumentType } from './documentBlocks';

// The clauses and templates the seed adds (07-documents-and-esign.md). They are written in plain language for the
// studio to adjust in the app, and the legal types are flagged "requires legal review" until the studio's lawyer has
// approved the wording. Nothing here is legal advice; see 18-open-questions.md.

export type ClauseSeed = { key: string; title: string; body: string; category: string };

export const DEFAULT_CLAUSES: readonly ClauseSeed[] = [
  {
    key: 'parties',
    title: 'Who this is between',
    category: 'General',
    body: 'This agreement is between {{org.legalName}} ("the studio"), of {{org.address}}, and {{client.legalName}} ("the client"), of {{client.address}}.',
  },
  {
    key: 'scope-of-work',
    title: 'What the studio will do',
    category: 'Scope',
    body: 'The studio will carry out the work described in this document. Anything not described here is outside the agreed scope, and is quoted separately as a change request.',
  },
  {
    key: 'client-responsibilities',
    title: 'What the client will do',
    category: 'Scope',
    body: 'The client will give the studio the content, access, approvals and decisions the work needs, within five working days of each request. Dates move by the same number of working days that a decision is late.',
  },
  {
    key: 'acceptance',
    title: 'Approving the work',
    category: 'Scope',
    body: 'The studio submits each deliverable for review. The client has five working days to approve it or ask for changes in writing. A deliverable not answered within that time is treated as approved.',
  },
  {
    key: 'change-control',
    title: 'Changes to the scope',
    category: 'Scope',
    body: 'Either side can propose a change. The studio then issues a change request setting out the effect on price and dates. Work on the change begins once the client approves it.',
  },
  {
    key: 'payment-terms',
    title: 'Payment',
    category: 'Money',
    body: 'Invoices are payable within the terms shown on the invoice, in {{totals.currency}}, to the account named on it. The payment schedule for this work is: {{schedule.summary}}.',
  },
  {
    key: 'late-payment',
    title: 'Late payment',
    category: 'Money',
    body: 'The studio may pause work on an invoice that is more than fourteen days overdue, and may charge interest on the overdue amount at the rate shown in the invoice. Work resumes when the account is settled.',
  },
  {
    key: 'taxes',
    title: 'Taxes',
    category: 'Money',
    body: 'Prices exclude VAT unless the document says otherwise. Where the client deducts withholding tax, the client gives the studio the withholding tax credit note.',
  },
  {
    key: 'expenses',
    title: 'Expenses',
    category: 'Money',
    body: 'Expenses such as licences, stock assets, hosting and travel are charged at cost, and only when the client has agreed to them in writing beforehand.',
  },
  {
    key: 'intellectual-property',
    title: 'Who owns the work',
    category: 'Legal',
    body: 'The client owns the deliverables once every invoice for them is paid in full. The studio keeps ownership of its own tools, libraries and know-how, and grants the client a licence to use those where they are part of a deliverable.',
  },
  {
    key: 'confidentiality',
    title: 'Confidentiality',
    category: 'Legal',
    body: 'Each side keeps the other’s confidential information private, uses it only for this work, and protects it as carefully as its own. This continues for three years after the work ends.',
  },
  {
    key: 'data-protection',
    title: 'Personal data',
    category: 'Legal',
    body: 'Where the studio handles personal data on the client’s behalf, it does so only on the client’s written instructions, keeps it secure, and follows the Nigeria Data Protection Act 2023.',
  },
  {
    key: 'warranty',
    title: 'Putting faults right',
    category: 'Legal',
    body: 'The studio will fix faults in a deliverable that are reported within thirty days of approval, at no charge, where the fault is in work the studio carried out.',
  },
  {
    key: 'liability',
    title: 'Limits on liability',
    category: 'Legal',
    body: 'Neither side is liable for indirect or consequential loss. Each side’s total liability under this agreement is limited to the fees paid under it in the twelve months before the claim.',
  },
  {
    key: 'termination',
    title: 'Ending the agreement',
    category: 'Legal',
    body: 'Either side may end this agreement with thirty days’ written notice. The client pays for work done and costs committed up to that date, and the studio hands over the work paid for.',
  },
  {
    key: 'governing-law',
    title: 'Governing law',
    category: 'Legal',
    body: 'This agreement is governed by the laws of the Federal Republic of Nigeria, and the courts of Lagos State have jurisdiction over any dispute.',
  },
  {
    key: 'validity',
    title: 'How long this is open',
    category: 'General',
    body: 'This document is valid until {{validUntil}}. After that date the prices and dates in it may change.',
  },
];

const heading = (text: string, level = 1): DocumentBlock => ({ kind: 'heading', text, level });
const paragraph = (text: string): DocumentBlock => ({ kind: 'paragraph', text });
const clause = (clauseKey: string): DocumentBlock => ({ kind: 'clause', clauseKey });
const lineItems = (title?: string): DocumentBlock => ({ kind: 'lineItems', title });
const totals = (): DocumentBlock => ({ kind: 'totals' });
const milestones = (title?: string): DocumentBlock => ({ kind: 'milestones', title });
const paymentSchedule = (title?: string): DocumentBlock => ({ kind: 'paymentSchedule', title });
const signature = (party: 'client' | 'studio'): DocumentBlock => ({ kind: 'signature', party });

const ADDRESSED_TO = paragraph(
  'Prepared for {{contact.name}}, {{contact.jobTitle}} at {{client.displayName}}, on {{today}}.',
);

export type DocumentTemplateSeed = {
  type: DocumentType;
  name: string;
  description: string;
  blocks: DocumentBlock[];
};

export const DEFAULT_DOCUMENT_TEMPLATES: readonly DocumentTemplateSeed[] = [
  {
    type: 'quote',
    name: 'Quote',
    description: 'A price for defined work, open until a date.',
    blocks: [
      heading('What this covers'),
      ADDRESSED_TO,
      paragraph(
        'Thank you for the conversation. Here is what the work would cost. Everything below is open to discussion.',
      ),
      heading('What is included', 2),
      lineItems('The work'),
      totals(),
      clause('validity'),
      heading('What happens next', 2),
      paragraph(
        'Accept this quote in your client portal and we will send a statement of work with dates and milestones. If anything here is not quite right, tell us and we will revise it.',
      ),
      clause('payment-terms'),
      clause('taxes'),
    ],
  },
  {
    type: 'proposal',
    name: 'Proposal',
    description: 'Approach, scope, timeline and price for a piece of work.',
    blocks: [
      heading('{{document.title}}'),
      ADDRESSED_TO,
      heading('What you asked for', 2),
      paragraph(
        'Write, in two or three sentences, what {{client.displayName}} wants to achieve and why it matters now. Use their words.',
      ),
      heading('How we would approach it', 2),
      paragraph(
        'Describe the approach in plain language: the phases, what happens in each, and who from the studio is involved.',
      ),
      heading('What you get', 2),
      clause('scope-of-work'),
      lineItems('Scope and price'),
      totals(),
      heading('Timeline', 2),
      milestones('Milestones'),
      heading('What we need from you', 2),
      clause('client-responsibilities'),
      clause('validity'),
      clause('payment-terms'),
      clause('taxes'),
      heading('Next step', 2),
      paragraph('Accept this proposal in your client portal, or reply with anything you would like changed.'),
    ],
  },
  {
    type: 'sow',
    name: 'Statement of work',
    description: 'Detailed scope, deliverables, milestones and acceptance terms.',
    blocks: [
      heading('What this statement of work covers'),
      paragraph(
        'This statement of work covers {{project.name}} ({{project.code}}) for {{client.legalName}}, starting {{project.startDate}} and due {{project.dueDate}}. It sits under the services agreement between us.',
      ),
      clause('parties'),
      heading('Scope', 2),
      clause('scope-of-work'),
      lineItems('Deliverables and price'),
      totals(),
      heading('Milestones', 2),
      milestones(),
      heading('Payment', 2),
      paymentSchedule('Payment schedule'),
      clause('payment-terms'),
      clause('late-payment'),
      clause('expenses'),
      heading('How work is approved', 2),
      clause('acceptance'),
      clause('change-control'),
      clause('client-responsibilities'),
      heading('Terms', 2),
      clause('intellectual-property'),
      clause('warranty'),
      { kind: 'pageBreak' },
      heading('Signatures', 2),
      paragraph('By signing, both sides agree to the scope, price and dates set out above.'),
      signature('client'),
      signature('studio'),
    ],
  },
  {
    type: 'contract',
    name: 'Master services agreement',
    description: 'The standing terms every statement of work sits under. Requires legal review.',
    blocks: [
      heading('Master services agreement'),
      paragraph('Dated {{today}}.'),
      clause('parties'),
      heading('How we work together', 2),
      paragraph(
        'This agreement sets the terms for all work the studio does for the client. Each piece of work is described in its own statement of work, which takes these terms as read.',
      ),
      clause('scope-of-work'),
      clause('client-responsibilities'),
      clause('acceptance'),
      clause('change-control'),
      heading('Money', 2),
      clause('payment-terms'),
      clause('late-payment'),
      clause('taxes'),
      clause('expenses'),
      heading('Ownership and confidentiality', 2),
      clause('intellectual-property'),
      clause('confidentiality'),
      clause('data-protection'),
      heading('Responsibility', 2),
      clause('warranty'),
      clause('liability'),
      clause('termination'),
      clause('governing-law'),
      { kind: 'pageBreak' },
      heading('Signatures', 2),
      signature('client'),
      signature('studio'),
    ],
  },
  {
    type: 'sla',
    name: 'Service level agreement',
    description: 'Support hours, response and resolution targets, and what happens when they are missed.',
    blocks: [
      heading('Service level agreement'),
      paragraph(
        'This agreement covers support for {{client.displayName}} from {{today}}. It describes when the studio is available, how quickly it responds, and what happens if it does not.',
      ),
      heading('Support hours', 2),
      paragraph(
        'Support runs during the studio’s business hours, excluding public holidays. Requests outside those hours are picked up on the next working day.',
      ),
      heading('Response and resolution targets', 2),
      paragraph(
        'State the target first response and resolution time for each priority: urgent, high, normal and low. These are measured in business hours.',
      ),
      heading('What is covered', 2),
      clause('scope-of-work'),
      paragraph(
        'New features, redesigns and work on systems the studio did not build are quoted separately as projects or change requests.',
      ),
      heading('If a target is missed', 2),
      paragraph(
        'The studio reports on targets monthly. Where a target is missed, the remedy agreed with the client is applied, such as a credit against the next retainer period.',
      ),
      heading('Fees', 2),
      lineItems('Support fees'),
      totals(),
      clause('payment-terms'),
      { kind: 'pageBreak' },
      heading('Signatures', 2),
      signature('client'),
      signature('studio'),
    ],
  },
  {
    type: 'nda',
    name: 'Mutual non-disclosure agreement',
    description: 'Keeps information shared in both directions private. Requires legal review.',
    blocks: [
      heading('Mutual non-disclosure agreement'),
      paragraph('Dated {{today}}.'),
      clause('parties'),
      heading('What is confidential', 2),
      paragraph(
        'Anything either side shares that is marked confidential, or that a reasonable person would treat as confidential, including plans, designs, code, customer lists, pricing and unreleased work.',
      ),
      heading('What each side agrees', 2),
      clause('confidentiality'),
      paragraph(
        'This does not cover information that is already public, that the receiving side already had, that it develops on its own, or that it must disclose by law. Where the law requires disclosure, the receiving side tells the other side first where it is allowed to.',
      ),
      heading('Returning information', 2),
      paragraph(
        'On request, each side returns or deletes the other’s confidential information, except copies it must keep by law.',
      ),
      clause('governing-law'),
      { kind: 'pageBreak' },
      heading('Signatures', 2),
      signature('client'),
      signature('studio'),
    ],
  },
  {
    type: 'dpa',
    name: 'Data processing agreement',
    description: 'How the studio handles personal data on the client’s behalf. Requires legal review.',
    blocks: [
      heading('Data processing agreement'),
      paragraph('Dated {{today}}. This agreement forms part of the services agreement between us.'),
      clause('parties'),
      heading('Roles', 2),
      paragraph(
        'The client decides why and how personal data is processed. The studio processes it only on the client’s written instructions, as the client’s processor.',
      ),
      heading('What is processed', 2),
      paragraph(
        'Describe the personal data involved, whose data it is, what is done with it, and how long it is kept. Keep this specific to {{project.name}}.',
      ),
      clause('data-protection'),
      heading('Security', 2),
      paragraph(
        'The studio keeps personal data encrypted in transit and at rest, limits access to the people who need it, records who accessed what, and reviews access when someone leaves.',
      ),
      heading('Sub-processors', 2),
      paragraph(
        'The studio uses the sub-processors listed in this agreement, and tells the client before adding another so the client can object.',
      ),
      heading('If something goes wrong', 2),
      paragraph(
        'The studio tells the client without undue delay, and in any case within 24 hours of becoming aware of a personal data breach, and helps the client meet its own obligations.',
      ),
      heading('When the work ends', 2),
      paragraph(
        'The studio returns or deletes the personal data at the client’s choice, except what it must keep by law, and confirms in writing when it has.',
      ),
      clause('governing-law'),
      { kind: 'pageBreak' },
      heading('Signatures', 2),
      signature('client'),
      signature('studio'),
    ],
  },
  {
    type: 'change_request',
    name: 'Change request',
    description: 'A priced change to scope, dates or both.',
    blocks: [
      heading('What is changing'),
      paragraph(
        'For {{project.name}} ({{project.code}}), requested on {{today}}. This changes the statement of work already agreed; everything not mentioned here stays as it was.',
      ),
      heading('What is changing', 2),
      paragraph('Describe the change and why it is needed, in the client’s terms.'),
      heading('Effect on price', 2),
      lineItems('Change'),
      totals(),
      heading('Effect on dates', 2),
      paragraph(
        'State how many working days this adds or removes, and the new due date. Say plainly if there is no effect on dates.',
      ),
      clause('change-control'),
      clause('payment-terms'),
      heading('Approval', 2),
      paragraph('Work on this change starts once it is approved.'),
      signature('client'),
    ],
  },
  {
    type: 'handover',
    name: 'Handover document',
    description: 'What was delivered, what was transferred, and what the client now holds.',
    blocks: [
      heading('Handover: {{project.name}}'),
      paragraph(
        'Completed {{today}} for {{client.displayName}}. This records what was delivered on {{project.code}} and what has been transferred to you.',
      ),
      heading('What was delivered', 2),
      milestones('Milestones and deliverables'),
      heading('What has been transferred', 2),
      paragraph(
        'List the repositories, domains, hosting and third-party accounts, app store listings and credentials handed over, and the date each was transferred.',
      ),
      heading('Where things live', 2),
      paragraph('List the production and staging addresses, the repository, and where the documentation is kept.'),
      heading('Ownership', 2),
      clause('intellectual-property'),
      heading('Support from here', 2),
      paragraph(
        'Say what support continues, under which agreement, and who to contact. If support has ended, say that plainly and how to start it again.',
      ),
      clause('warranty'),
      { kind: 'pageBreak' },
      heading('Signatures', 2),
      paragraph('Signing confirms the work above was delivered and the items listed were transferred.'),
      signature('client'),
      signature('studio'),
    ],
  },
  {
    type: 'team_agreement',
    name: 'Contractor agreement',
    description: 'For a contractor joining the studio’s team. Requires legal review.',
    blocks: [
      heading('Contractor agreement'),
      paragraph('Dated {{today}}, between {{org.legalName}} and the contractor named below.'),
      heading('The work', 2),
      paragraph(
        'Describe what the contractor will do, for which projects, and who they report to. Include the agreed rate, how time is recorded, and how invoices are submitted.',
      ),
      heading('How time is recorded', 2),
      paragraph(
        'The contractor logs time in Unbuilt OS against the project they are working on, and submits each week for approval.',
      ),
      heading('Payment', 2),
      clause('payment-terms'),
      clause('taxes'),
      heading('Ownership and confidentiality', 2),
      paragraph(
        'Everything the contractor creates for the studio belongs to the studio, and through the studio to its client, once paid for.',
      ),
      clause('confidentiality'),
      clause('data-protection'),
      heading('Status', 2),
      paragraph(
        'The contractor is self-employed, is responsible for their own taxes, and is free to work for others where that does not conflict with this work.',
      ),
      clause('termination'),
      clause('governing-law'),
      { kind: 'pageBreak' },
      heading('Signatures', 2),
      signature('client'),
      signature('studio'),
    ],
  },
];
