import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signing, type SigningPage } from '@/lib/signing-client';
import { SigningCeremony } from './signing-ceremony';

// The signing page (07-documents-and-esign.md, The signing ceremony): read, confirm with a code, sign or decline, and
// say plainly what happened when the link no longer opens the document.

vi.mock('@/lib/signing-client', () => ({
  signing: { view: vi.fn(), code: vi.fn(), verify: vi.fn(), upload: vi.fn(), sign: vi.fn(), decline: vi.fn() },
  uploadSignature: vi.fn(),
}));

const api = vi.mocked(signing);
const TOKEN = 'a-long-signing-token-value';
const CONSENT =
  'I agree that my electronic signature is the legal equivalent of my handwritten signature on this document.';

const page = (overrides: Partial<SigningPage> = {}): SigningPage => ({
  signer: { name: 'Ada Obi', email: 'ada@glossup.com', status: 'invited', codeVerified: false },
  request: { status: 'pending', expiresAt: Date.parse('2026-10-06T09:00:00Z'), expired: false },
  studioName: 'Unbuilt Studio',
  title: 'Glossup services agreement',
  number: 'UNB-NDA-0001',
  typeLabel: 'Non-disclosure agreement',
  document: {
    currency: 'NGN',
    blocks: [
      { kind: 'heading', text: 'Mutual non-disclosure agreement' },
      { kind: 'paragraph', text: 'Each side keeps the other’s information private.' },
    ],
    pdfUrl: 'https://example.convex.site/files/download?sig=x',
    pdfSha256: 'a'.repeat(64),
  },
  consent: { text: CONSENT, version: 1 },
  ...overrides,
});

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.view.mockResolvedValue({ ok: true, page: page() });
  api.code.mockResolvedValue({ ok: true, sentTo: 'a…@glossup.com' });
  // input-otp measures layout; jsdom has none.
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  document.elementFromPoint ??= () => null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('SigningCeremony', () => {
  it('shows the document in full with its PDF, then confirms the email and signs with a typed name', async () => {
    api.verify.mockResolvedValue({ ok: true, verified: true });
    api.sign.mockResolvedValue({ ok: true });
    render(<SigningCeremony token={TOKEN} />);

    expect(
      await screen.findByRole('heading', { level: 1, name: /Non-disclosure agreement UNB-NDA-0001/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Each side keeps the other’s information private.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Download the PDF/ })).toHaveAttribute('rel', 'noreferrer');

    await userEvent.click(screen.getByRole('button', { name: 'I have read it, sign' }));
    await userEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    expect(api.code).toHaveBeenCalledWith(TOKEN);
    await userEvent.type(await screen.findByLabelText('The code from the email'), '482913');
    await waitFor(() => expect(api.verify).toHaveBeenCalledWith(TOKEN, '482913'));

    // The name is filled in from the request; signing waits for consent.
    expect(await screen.findByLabelText('Your full name')).toHaveValue('Ada Obi');
    const sign = screen.getByRole('button', { name: 'Sign' });
    expect(sign).toBeDisabled();
    await userEvent.click(screen.getByLabelText(CONSENT));
    await userEvent.click(sign);

    await waitFor(() =>
      expect(api.sign).toHaveBeenCalledWith(TOKEN, {
        method: 'typed',
        typedName: 'Ada Obi',
        imageStorageId: undefined,
        consent: true,
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Thank you, you have signed' })).toBeInTheDocument();
  });

  it('says how many tries are left after a wrong code, and shows the lock when they run out', async () => {
    api.verify.mockResolvedValueOnce({ ok: true, verified: false, locked: false, attemptsLeft: 2 });
    render(<SigningCeremony token={TOKEN} />);
    await userEvent.click(await screen.findByRole('button', { name: 'I have read it, sign' }));
    await userEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    await userEvent.type(await screen.findByLabelText('The code from the email'), '000000');
    expect(await screen.findByRole('alert')).toHaveTextContent('2 tries left before the link locks');

    api.verify.mockResolvedValueOnce({ ok: true, verified: false, locked: true, attemptsLeft: 0 });
    api.view.mockResolvedValue({
      ok: true,
      page: page({ signer: { ...page().signer, status: 'locked' }, document: null, consent: null }),
    });
    await userEvent.type(screen.getByLabelText('The code from the email'), '111111');
    expect(await screen.findByRole('heading', { name: 'This link is locked' })).toBeInTheDocument();
  });

  it('goes straight to signing when the code was already checked', async () => {
    api.view.mockResolvedValue({ ok: true, page: page({ signer: { ...page().signer, codeVerified: true } }) });
    render(<SigningCeremony token={TOKEN} />);
    await userEvent.click(await screen.findByRole('button', { name: 'I have read it, sign' }));
    expect(screen.getByLabelText('Your full name')).toBeInTheDocument();
    expect(api.code).not.toHaveBeenCalled();
  });

  it('declines with a reason', async () => {
    api.view.mockResolvedValue({ ok: true, page: page({ signer: { ...page().signer, codeVerified: true } }) });
    api.decline.mockResolvedValue({ ok: true });
    render(<SigningCeremony token={TOKEN} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Decline to sign' }));
    const decline = screen.getByRole('button', { name: 'Decline to sign' });
    expect(decline).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Why are you declining?'), 'The term is too long');
    await userEvent.click(decline);
    await waitFor(() => expect(api.decline).toHaveBeenCalledWith(TOKEN, 'The term is too long'));
    expect(await screen.findByRole('heading', { name: 'You declined to sign' })).toBeInTheDocument();
  });

  it('asks for the code again when the signing window has passed', async () => {
    api.view.mockResolvedValue({ ok: true, page: page({ signer: { ...page().signer, codeVerified: true } }) });
    api.sign.mockResolvedValue({ ok: false, code: 'signatures.codeNeeded', message: 'Confirm your email first' });
    render(<SigningCeremony token={TOKEN} />);
    await userEvent.click(await screen.findByRole('button', { name: 'I have read it, sign' }));
    await userEvent.click(screen.getByLabelText(CONSENT));
    await userEvent.click(screen.getByRole('button', { name: 'Sign' }));
    expect(await screen.findByRole('button', { name: 'Email me a code' })).toBeInTheDocument();
  });

  it('explains a link that does not work, without showing anything', async () => {
    api.view.mockResolvedValue({ ok: false, code: 'signatures.notFound', message: 'This signing link is not valid.' });
    render(<SigningCeremony token={TOKEN} />);
    expect(await screen.findByRole('heading', { name: 'This signing link does not work' })).toBeInTheDocument();
    expect(screen.getByText(/This signing link is not valid\./)).toBeInTheDocument();
  });

  it('says what happened once the request has closed', async () => {
    api.view.mockResolvedValue({
      ok: true,
      page: page({ request: { ...page().request, status: 'cancelled' }, document: null, consent: null }),
    });
    render(<SigningCeremony token={TOKEN} />);
    expect(
      await screen.findByRole('heading', { name: 'This document is no longer open for signing' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Unbuilt Studio has cancelled this signing request/)).toBeInTheDocument();
  });

  it('tells a signer who has signed that the copy follows', async () => {
    api.view.mockResolvedValue({
      ok: true,
      page: page({ signer: { ...page().signer, status: 'signed' }, document: null, consent: null }),
    });
    render(<SigningCeremony token={TOKEN} />);
    expect(await screen.findByRole('heading', { name: 'You have signed this' })).toBeInTheDocument();
    expect(screen.getByText(/We will email you a copy once everyone has signed/)).toBeInTheDocument();
  });
});
