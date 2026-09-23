import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { paying, type PayPageInvoice } from '@/lib/pay-client';
import { PayPage } from './pay-page';

// The public pay page (08-billing-and-finance.md, Paystack). It never claims an invoice is paid: it opens Paystack and
// waits for the studio's webhook to confirm.

vi.mock('@/lib/pay-client', () => ({ paying: { view: vi.fn(), start: vi.fn() } }));

const api = vi.mocked(paying);
const TOKEN = 'a-pay-token-value-1234567';

const invoice = (overrides: Partial<PayPageInvoice> = {}): PayPageInvoice => ({
  number: 'UNB-INV-0010',
  status: 'sent',
  studioName: 'Unbuilt Studio',
  clientName: 'Glossup',
  currency: 'NGN',
  totalMinor: 10_000_000,
  balanceMinor: 10_000_000,
  dueDate: '2026-10-07',
  payable: true,
  whtMinor: 0,
  whtBps: 0,
  byCard: true,
  bankAccounts: [{ bankName: 'GTBank', accountName: 'Unbuilt Studio Ltd', accountNumber: '0123456789' }],
  ...overrides,
});

const assign = vi.fn();

beforeEach(() => {
  api.view.mockReset();
  api.start.mockReset();
  api.view.mockResolvedValue({ ok: true, invoice: invoice() });
  vi.stubGlobal('location', {
    ...window.location,
    set href(value: string) {
      assign(value);
    },
  });
  assign.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PayPage', () => {
  it('shows what is owed, the bank details, and opens Paystack for the balance', async () => {
    api.start.mockResolvedValue({
      ok: true,
      authorizationUrl: 'https://checkout.paystack.com/abc',
      amountMinor: 10_000_000,
    });
    render(<PayPage token={TOKEN} />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Invoice UNB-INV-0010' })).toBeInTheDocument();
    expect(screen.getByText(/₦100,000.00 still owed/)).toBeInTheDocument();
    expect(screen.getByText('Account 0123456789')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Pay ₦100,000.00' }));
    await waitFor(() => expect(api.start).toHaveBeenCalledWith(TOKEN, false));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.paystack.com/abc'));
  });

  it('offers the WHT-reduced amount to a client who withholds tax', async () => {
    api.view.mockResolvedValue({ ok: true, invoice: invoice({ whtMinor: 500_000, whtBps: 500 }) });
    api.start.mockResolvedValue({
      ok: true,
      authorizationUrl: 'https://checkout.paystack.com/abc',
      amountMinor: 9_500_000,
    });
    render(<PayPage token={TOKEN} />);

    await userEvent.click(await screen.findByLabelText(/We withhold tax at 5%/));
    expect(screen.getByRole('button', { name: 'Pay ₦95,000.00' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pay ₦95,000.00' }));
    await waitFor(() => expect(api.start).toHaveBeenCalledWith(TOKEN, true));
  });

  it('offers only bank transfer where cards are not taken, and says when nothing is owed', async () => {
    api.view.mockResolvedValue({ ok: true, invoice: invoice({ byCard: false }) });
    const { unmount } = render(<PayPage token={TOKEN} />);
    expect(await screen.findByText('This invoice is paid by bank transfer.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Pay/ })).not.toBeInTheDocument();
    unmount();

    api.view.mockResolvedValue({ ok: true, invoice: invoice({ payable: false, balanceMinor: 0, status: 'paid' }) });
    render(<PayPage token={TOKEN} />);
    expect(await screen.findByRole('heading', { name: 'UNB-INV-0010 is settled' })).toBeInTheDocument();
  });

  it('explains a link that does not work, and never claims a payment on its own', async () => {
    api.view.mockResolvedValue({ ok: false, code: 'invoices.notFound', message: 'This payment link is not valid.' });
    const { unmount } = render(<PayPage token={TOKEN} />);
    expect(await screen.findByRole('heading', { name: 'This payment link does not work' })).toBeInTheDocument();
    unmount();

    api.view.mockResolvedValue({ ok: true, invoice: invoice() });
    render(<PayPage token={TOKEN} returned />);
    expect(await screen.findByRole('status')).toHaveTextContent('We are confirming the payment with Paystack');
    expect(screen.getByRole('button', { name: 'Pay ₦100,000.00' })).toBeInTheDocument();
  });
});
