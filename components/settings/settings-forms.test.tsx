import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BillingForm, toBillingArgs } from './billing-form';
import { LogoUploader } from './logo-uploader';
import { OrganisationForm, toOrganisationArgs } from './organisation-form';

const state = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock('convex/react', () => ({
  useQuery: (ref: { _name: string }, args?: unknown) => (args === 'skip' ? undefined : state.queries[ref._name]),
  useMutation: (ref: { _name: string }) => {
    state.mutations[ref._name] ??= vi.fn();
    return state.mutations[ref._name];
  },
}));

vi.mock('@/convex/_generated/api', () => {
  const ref = (name: string) => ({ _name: name });
  return {
    api: {
      settings: {
        getOrganisation: ref('getOrganisation'),
        updateOrganisation: ref('updateOrganisation'),
        getBilling: ref('getBilling'),
        updateBilling: ref('updateBilling'),
        generateLogoUploadUrl: ref('generateLogoUploadUrl'),
        setLogo: ref('setLogo'),
        removeLogo: ref('removeLogo'),
      },
      files: { teamDownloadUrl: ref('teamDownloadUrl') },
    },
  };
});

const organisation = {
  legalName: 'Unbuilt Studio Ltd',
  addressLines: ['12 Example Street', 'Lagos'],
  country: 'NG',
  timezone: 'Africa/Lagos',
  retentionYears: 7,
  brand: { primary: '#000000', accent: '#FFC400' },
};

const DEFAULT_NUMBERING_VIEW = {
  invoice: { prefix: 'UNB-INV-', padding: 4 },
  quote: { prefix: 'UNB-QUO-', padding: 4 },
  proposal: { prefix: 'UNB-PRO-', padding: 4 },
  sow: { prefix: 'UNB-SOW-', padding: 4 },
  contract: { prefix: 'UNB-CON-', padding: 4 },
  sla: { prefix: 'UNB-SLA-', padding: 4 },
  changeRequest: { prefix: 'UNB-CR-', padding: 4 },
  creditNote: { prefix: 'UNB-CN-', padding: 4 },
  receipt: { prefix: 'UNB-RCT-', padding: 4 },
  ticket: { prefix: 'UNB-TKT-', padding: 4 },
  project: { prefix: 'UNB-P-', padding: 4 },
};

const billing = {
  defaultCurrency: 'NGN',
  bankAccounts: [],
  numbering: DEFAULT_NUMBERING_VIEW,
  defaultVatBps: 750,
  lateFeePolicy: { enabled: false, monthlyBps: 500 },
};

beforeEach(() => {
  state.queries = { getOrganisation: organisation, getBilling: billing };
  state.mutations = {};
});

describe('OrganisationForm', () => {
  it('saves cleaned values and only enables saving once something changed', async () => {
    render(<OrganisationForm />);
    const save = await screen.findByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();

    await userEvent.type(screen.getByLabelText('TIN'), ' 12345678-0001 ');
    await userEvent.clear(screen.getByLabelText('Address'));
    await userEvent.type(screen.getByLabelText('Address'), '  12 Example Street {enter}{enter}Ikoyi, Lagos');
    await userEvent.click(save);

    await waitFor(() =>
      expect(state.mutations.updateOrganisation).toHaveBeenCalledWith(
        expect.objectContaining({ tin: '12345678-0001', addressLines: ['12 Example Street', 'Ikoyi, Lagos'] }),
      ),
    );
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('explains an invalid field next to it and does not save', async () => {
    render(<OrganisationForm />);
    const country = await screen.findByLabelText('Country');
    await userEvent.clear(country);
    await userEvent.type(country, 'N1');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Use the two-letter country code, such as NG')).toBeInTheDocument();
    expect(country).toHaveAttribute('aria-invalid', 'true');
    expect(state.mutations.updateOrganisation).not.toHaveBeenCalled();
  });

  it('shows the server’s message when saving fails', async () => {
    render(<OrganisationForm />);
    state.mutations.updateOrganisation.mockRejectedValue(
      new ConvexError({ code: 'settings.invalid', message: '"Mars/Base" is not a timezone' }),
    );
    await userEvent.type(await screen.findByLabelText('Trading name'), 'Unbuilt');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('"Mars/Base" is not a timezone');
  });

  it('turns empty optional fields into nothing and uppercases the country', () => {
    expect(
      toOrganisationArgs({
        legalName: ' ',
        tradingName: '',
        address: '\n a \n\n b ',
        country: 'ng',
        tin: '',
        vatNumber: ' VAT1 ',
        timezone: 'Africa/Lagos',
        retentionYears: '7',
        brandPrimary: '#000000',
        brandAccent: '#FFC400',
      }),
    ).toEqual({
      legalName: undefined,
      tradingName: undefined,
      addressLines: ['a', 'b'],
      country: 'NG',
      tin: undefined,
      vatNumber: 'VAT1',
      timezone: 'Africa/Lagos',
      retentionYears: 7,
      brand: { primary: '#000000', accent: '#FFC400' },
    });
  });
});

describe('BillingForm', () => {
  it('saves VAT as basis points and adds a bank account', async () => {
    render(<BillingForm />);
    const vat = await screen.findByLabelText('VAT (%)');
    expect(vat).toHaveValue('7.5');
    await userEvent.clear(vat);
    await userEvent.type(vat, '8');
    await userEvent.type(screen.getByLabelText('Payment terms (days)'), '14');

    await userEvent.click(screen.getByRole('button', { name: 'Add account' }));
    const account = screen.getByRole('group', { name: 'Account 1' });
    await userEvent.type(within(account).getByLabelText('Label'), 'Naira');
    await userEvent.type(within(account).getByLabelText('Bank name'), 'Example Bank');
    await userEvent.type(within(account).getByLabelText('Account name'), 'Unbuilt Studio');
    await userEvent.type(within(account).getByLabelText('Account number'), '0123456789');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(state.mutations.updateBilling).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultVatBps: 800,
          defaultPaymentTermsDays: 14,
          numbering: {},
          bankAccounts: [expect.objectContaining({ label: 'Naira', accountNumber: '0123456789', swift: undefined })],
        }),
      ),
    );
  });

  it('blocks saving an incomplete bank account or an invalid percentage', async () => {
    render(<BillingForm />);
    const vat = await screen.findByLabelText('VAT (%)');
    await userEvent.clear(vat);
    await userEvent.type(vat, '7.555');
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Enter a percentage from 0 to 100, with at most two decimals')).toBeInTheDocument();
    expect(screen.getByText('Account number is required')).toBeInTheDocument();
    expect(state.mutations.updateBilling).not.toHaveBeenCalled();
  });

  it('previews number formats and only asks for late fee details when late fees are on', async () => {
    render(<BillingForm />);
    const prefix = await screen.findByLabelText('Invoices prefix');
    await userEvent.clear(prefix);
    await userEvent.type(prefix, 'INV/');
    const row = prefix.closest('tr')!;
    expect(within(row).getByText('INV/0001')).toBeInTheDocument();

    expect(screen.queryByLabelText('Monthly rate (%)')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: 'Charge late fees' }));
    expect(screen.getByLabelText('Monthly rate (%)')).toHaveValue('5');
  });

  it('keeps only numbering that differs from the defaults', () => {
    const numbering = Object.fromEntries(
      Object.entries(DEFAULT_NUMBERING_VIEW).map(([record, f]) => [
        record,
        { prefix: f.prefix, padding: String(f.padding) },
      ]),
    );
    numbering.invoice = { prefix: 'INV-', padding: '6' };
    const args = toBillingArgs({
      defaultCurrency: 'NGN',
      vatPercent: '7.5',
      paymentTermsDays: '',
      quoteValidityDays: '30',
      lateFeeEnabled: false,
      lateFeePercent: '5',
      lateFeeGraceDays: '',
      invoiceFooter: '  ',
      numbering,
      bankAccounts: [],
    });
    expect(args).toMatchObject({
      numbering: { invoice: { prefix: 'INV-', padding: 6 } },
      defaultPaymentTermsDays: undefined,
      quoteValidityDays: 30,
      invoiceFooter: undefined,
      lateFeePolicy: { enabled: false, monthlyBps: 500, graceDays: undefined },
    });
  });
});

describe('LogoUploader', () => {
  const choose = async (file: File) => {
    await userEvent.upload(screen.getByLabelText('Logo file'), file, { applyAccept: false });
  };

  it('refuses the wrong type or size before uploading anything', async () => {
    render(<LogoUploader />);
    await choose(new File(['%PDF'], 'logo.pdf', { type: 'application/pdf' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Use a PNG, JPEG, WebP, GIF or SVG image.');

    const big = new File(['x'], 'logo.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    await choose(big);
    expect(await screen.findByRole('alert')).toHaveTextContent('at most 10 MB');
    expect(state.mutations.generateLogoUploadUrl).not.toHaveBeenCalled();
  });

  it('uploads to storage, then records the logo with its declared type', async () => {
    render(<LogoUploader />);
    state.mutations.generateLogoUploadUrl.mockResolvedValue('https://upload.example/abc');
    state.mutations.setLogo.mockResolvedValue({ ok: true, fileId: 'file1' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ storageId: 'storage1' }) });
    vi.stubGlobal('fetch', fetchMock);

    await choose(new File(['png'], 'mark.png', { type: 'image/png' }));
    expect(await screen.findByText('Logo updated.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://upload.example/abc',
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'image/png' } }),
    );
    expect(state.mutations.setLogo).toHaveBeenCalledWith({
      storageId: 'storage1',
      name: 'mark.png',
      contentType: 'image/png',
    });
    vi.unstubAllGlobals();
  });

  it('shows why the server rejected an upload', async () => {
    render(<LogoUploader />);
    state.mutations.generateLogoUploadUrl.mockResolvedValue('https://upload.example/abc');
    state.mutations.setLogo.mockResolvedValue({ ok: false, code: 'files.typeMismatch', message: 'Not really a PNG' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ storageId: 's' }) }));

    await choose(new File(['x'], 'mark.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not really a PNG');
    vi.unstubAllGlobals();
  });
});
