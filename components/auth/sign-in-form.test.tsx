import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authClient } from '@/lib/auth-client';
import { SignInForm } from './sign-in-form';

vi.mock('@/lib/auth-client', () => ({
  authClient: { signIn: { magicLink: vi.fn() } },
}));

const magicLink = vi.mocked(authClient.signIn.magicLink);

beforeEach(() => {
  magicLink.mockReset();
});

describe('SignInForm', () => {
  it('requests a magic link that returns to where the person was going', async () => {
    magicLink.mockResolvedValue({ data: { status: true }, error: null } as never);
    render(<SignInForm surface="team" callbackURL="/clients" initialError={null} />);

    await userEvent.type(screen.getByLabelText('Email'), '  dayo@unbuilt.studio ');
    await userEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));

    expect(magicLink).toHaveBeenCalledWith({
      email: 'dayo@unbuilt.studio',
      callbackURL: '/clients',
      errorCallbackURL: '/sign-in',
    });
    const heading = await screen.findByRole('heading', { name: 'Check your email' });
    expect(heading).toHaveFocus();
    expect(screen.getByText('dayo@unbuilt.studio')).toBeInTheDocument();
  });

  it('says the same thing whether or not the address has access', async () => {
    magicLink.mockResolvedValue({ data: { status: true }, error: null } as never);
    render(<SignInForm surface="portal" callbackURL="/" initialError={null} />);
    await userEvent.type(screen.getByLabelText('Email'), 'stranger@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
    expect(await screen.findByText(/has access, we have sent a sign-in link/)).toBeInTheDocument();
  });

  it('explains rate limiting', async () => {
    magicLink.mockResolvedValue({ data: null, error: { status: 429 } } as never);
    render(<SignInForm surface="team" callbackURL="/" initialError={null} />);
    await userEvent.type(screen.getByLabelText('Email'), 'dayo@unbuilt.studio');
    await userEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many sign-in requests');
  });

  it('shows the error a failed link redirected with, tied to the email field', () => {
    render(<SignInForm surface="team" callbackURL="/" initialError="That sign-in link has expired." />);
    expect(screen.getByRole('alert')).toHaveTextContent('That sign-in link has expired.');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-describedby', 'sign-in-error');
  });

  it('words the intro for each surface', () => {
    const { unmount } = render(<SignInForm surface="portal" callbackURL="/" initialError={null} />);
    expect(screen.getByText(/the studio invited/)).toBeInTheDocument();
    unmount();
    render(<SignInForm surface="team" callbackURL="/" initialError={null} />);
    expect(screen.getByText(/studio email address/)).toBeInTheDocument();
  });
});
