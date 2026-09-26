import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LinkedText } from './linked-text';

// Links in text somebody else wrote (09-support-and-sla.md). Clickable, but never able to carry markup in with them.

describe('links in a message', () => {
  it('makes an address clickable, and opens it away from the app', () => {
    render(
      <p>
        <LinkedText>Broken page: https://staging.example.com/checkout</LinkedText>
      </p>,
    );
    const link = screen.getByRole('link', { name: 'https://staging.example.com/checkout' });
    expect(link).toHaveAttribute('href', 'https://staging.example.com/checkout');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('leaves the sentence’s own punctuation out of the address', () => {
    render(
      <p>
        <LinkedText>See https://example.com/page, then tell us.</LinkedText>
      </p>,
    );
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.com/page');
    expect(screen.getByText(/, then tell us\./)).toBeInTheDocument();
  });

  it('handles a link the sender wrapped in angle brackets', () => {
    render(
      <p>
        <LinkedText>{'the checkout step\n<https://staging.example.com/checkout>'}</LinkedText>
      </p>,
    );
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://staging.example.com/checkout');
  });

  it('never lets a client’s markup become markup', () => {
    render(
      <p data-testid="body">
        <LinkedText>{'<script>alert(1)</script> and <b>bold</b>'}</LinkedText>
      </p>,
    );
    // The tags are shown as the characters they are, not run or rendered.
    expect(screen.getByTestId('body')).toHaveTextContent('<script>alert(1)</script> and <b>bold</b>');
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
  });

  it('leaves text with no links exactly as it was', () => {
    render(
      <p data-testid="body">
        <LinkedText>Nothing to click here.</LinkedText>
      </p>,
    );
    expect(screen.getByTestId('body')).toHaveTextContent('Nothing to click here.');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
