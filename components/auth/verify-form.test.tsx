import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authClient } from '@/lib/auth-client';
import { verifyErrorMessage, VerifyForm } from './verify-form';

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    twoFactor: { sendOtp: vi.fn(), verifyOtp: vi.fn(), verifyTotp: vi.fn(), verifyBackupCode: vi.fn() },
  },
}));

const twoFactor = vi.mocked(authClient.twoFactor);
const ok = { data: { status: true }, error: null } as never;
const assign = vi.fn();

beforeEach(() => {
  for (const fn of Object.values(twoFactor)) fn.mockReset();
  twoFactor.sendOtp.mockResolvedValue(ok);
  vi.stubGlobal('location', { ...window.location, assign });
  assign.mockReset();
  // input-otp measures layout; jsdom has none.
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  document.elementFromPoint ??= () => null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VerifyForm for client users (emailed code)', () => {
  it('sends one code on arrival and verifies it, trusting the device by default', async () => {
    twoFactor.verifyOtp.mockResolvedValue(ok);
    render(<VerifyForm method="otp" callbackURL="/invoices" />);

    expect(await screen.findByText(/We have emailed you a 6-digit code/)).toBeInTheDocument();
    expect(twoFactor.sendOtp).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Send a new code in \d+s/ })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Code'), '482913');
    await waitFor(() => expect(twoFactor.verifyOtp).toHaveBeenCalledWith({ code: '482913', trustDevice: true }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/invoices'));
  });

  it('lets the person decline to trust the device', async () => {
    twoFactor.verifyOtp.mockResolvedValue(ok);
    render(<VerifyForm method="otp" callbackURL="/" />);
    await userEvent.click(screen.getByLabelText('Trust this device for 30 days'));
    await userEvent.type(screen.getByLabelText('Code'), '482913');
    await waitFor(() => expect(twoFactor.verifyOtp).toHaveBeenCalledWith({ code: '482913', trustDevice: false }));
  });
});

describe('VerifyForm for team members (authenticator)', () => {
  it('verifies a TOTP code and sends no email', async () => {
    twoFactor.verifyTotp.mockResolvedValue(ok);
    render(<VerifyForm method="totp" callbackURL="/" />);
    await userEvent.type(screen.getByLabelText('Code'), '123456');
    await waitFor(() => expect(twoFactor.verifyTotp).toHaveBeenCalledWith({ code: '123456' }));
    expect(twoFactor.sendOtp).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Trust this device for 30 days')).not.toBeInTheDocument();
  });

  it('accepts a backup code instead', async () => {
    twoFactor.verifyBackupCode.mockResolvedValue(ok);
    render(<VerifyForm method="totp" callbackURL="/" />);
    await userEvent.click(screen.getByRole('button', { name: 'Lost your authenticator? Use a backup code' }));
    await userEvent.type(screen.getByLabelText('Backup code'), 'abcde-12345');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(twoFactor.verifyBackupCode).toHaveBeenCalledWith({ code: 'abcde-12345' }));
  });

  it('keeps the person on the page with a clear message when the code is wrong', async () => {
    twoFactor.verifyTotp.mockResolvedValue({ data: null, error: { status: 401, code: 'INVALID_CODE' } } as never);
    render(<VerifyForm method="totp" callbackURL="/" />);
    await userEvent.type(screen.getByLabelText('Code'), '000000');
    expect(await screen.findByRole('alert')).toHaveTextContent('That code did not work');
    expect(assign).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: /Start again/ })).not.toBeInTheDocument();
  });
});

describe('verifyErrorMessage', () => {
  it('offers a fresh start when the challenge expired or was locked', () => {
    expect(verifyErrorMessage({ status: 401, code: 'INVALID_TWO_FACTOR_COOKIE' }).restart).toBe(true);
    expect(verifyErrorMessage({ status: 400, code: 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE' }).restart).toBe(true);
    expect(verifyErrorMessage({ status: 429 }).restart).toBe(true);
    expect(verifyErrorMessage({ status: 401, code: 'INVALID_CODE' }).restart).toBe(false);
  });
});
