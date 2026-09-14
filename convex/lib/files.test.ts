import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Doc, type Id } from '../_generated/dataModel';
import {
  canReadFile,
  contentDisposition,
  DOWNLOAD_URL_TTL_MS,
  FileError,
  sanitizeFileName,
  signedDownloadUrl,
  validateUpload,
  verifyDownloadSignature,
} from './files';
import { type ClientPrincipal, type TeamPrincipal } from './principals';

const MB = 1024 * 1024;

describe('validateUpload', () => {
  it.each([
    ['image', 'logo.png', 'image/png', MB],
    ['image', 'photo.JPG', 'image/jpeg; charset=binary', MB],
    ['document', 'contract.pdf', 'application/pdf', 9 * MB],
    ['deliverable', 'build.zip', 'application/zip', 90 * MB],
  ] as const)('accepts %s %s', (context, name, contentType, size) => {
    expect(validateUpload(context, { name, contentType, size }).mimeType).toBe(contentType.split(';')[0]);
  });

  it.each([
    ['too large for the context', 'image', 'big.png', 'image/png', 11 * MB, 'files.tooLarge'],
    ['a type the context does not allow', 'image', 'notes.pdf', 'application/pdf', MB, 'files.typeNotAllowed'],
    ['archives outside deliverables', 'document', 'build.zip', 'application/zip', MB, 'files.typeNotAllowed'],
    ['an extension that does not match the type', 'image', 'page.html', 'image/png', MB, 'files.typeMismatch'],
    ['a missing content type', 'document', 'notes.pdf', undefined, MB, 'files.typeNotAllowed'],
    ['an empty file', 'document', 'notes.pdf', 'application/pdf', 0, 'files.empty'],
  ] as const)('rejects %s', (_, context, name, contentType, size, code) => {
    let error: unknown;
    try {
      validateUpload(context, { name, contentType, size });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(FileError);
    expect((error as FileError).data.code).toBe(code);
  });
});

describe('file names', () => {
  it('drops folders, replaces control and reserved characters, and keeps the extension', () => {
    expect(sanitizeFileName('../../etc/passwd.pdf')).toBe('passwd.pdf');
    expect(sanitizeFileName('C:\\Users\\ada\\re:port?.pdf')).toBe('re_port_.pdf');
    expect(sanitizeFileName('tab\there.pdf')).toBe('tab_here.pdf');
    expect(sanitizeFileName('  Q3   report.pdf ')).toBe('Q3 report.pdf');
    expect(sanitizeFileName('...')).toBe('file');
  });

  it('builds a Content-Disposition with an ASCII fallback and UTF-8 name', () => {
    expect(contentDisposition('Naira ₦ "quote".pdf')).toBe(
      `attachment; filename="Naira _ _quote_.pdf"; filename*=UTF-8''Naira%20%E2%82%A6%20%22quote%22.pdf`,
    );
  });
});

describe('signed download links', () => {
  const fileId = 'kg2abc' as Id<'files'>;
  const now = Date.parse('2026-09-14T10:00:30Z');

  beforeEach(() => {
    vi.stubEnv('FILE_URL_SECRET', 'a-test-secret-that-is-at-least-32-chars');
    vi.stubEnv('CONVEX_SITE_URL', 'https://example.convex.site');
  });
  afterEach(() => vi.unstubAllEnvs());

  const paramsOf = (url: string) => {
    const params = new URL(url).searchParams;
    return { file: params.get('file'), expires: params.get('expires'), signature: params.get('signature') };
  };

  it('expire within the TTL, rounded up to the minute', async () => {
    const { url, expiresAt } = await signedDownloadUrl(fileId, now);
    expect(new URL(url).pathname).toBe('/files/download');
    expect(expiresAt - now).toBeGreaterThanOrEqual(DOWNLOAD_URL_TTL_MS);
    expect(expiresAt - now).toBeLessThan(DOWNLOAD_URL_TTL_MS + 60_000);
    expect(await verifyDownloadSignature(paramsOf(url), now)).toBe(fileId);
  });

  it('reject expired, tampered and other-file links', async () => {
    const { url, expiresAt } = await signedDownloadUrl(fileId, now);
    const params = paramsOf(url);
    expect(await verifyDownloadSignature(params, expiresAt + 1)).toBeNull();
    expect(await verifyDownloadSignature({ ...params, file: 'kg2other' }, now)).toBeNull();
    expect(await verifyDownloadSignature({ ...params, expires: String(expiresAt + 3_600_000) }, now)).toBeNull();
    expect(await verifyDownloadSignature({ ...params, signature: '0'.repeat(64) }, now)).toBeNull();
    expect(await verifyDownloadSignature({ ...params, signature: null }, now)).toBeNull();
  });

  it('refuse to sign without a strong secret', async () => {
    vi.stubEnv('FILE_URL_SECRET', 'short');
    await expect(signedDownloadUrl(fileId, now)).rejects.toThrow(/FILE_URL_SECRET/);
  });
});

describe('canReadFile', () => {
  const file = (overrides: Partial<Doc<'files'>>) =>
    ({
      owner: { table: 'tickets', id: 't1' },
      visibility: 'client',
      clientId: 'glossup',
      ...overrides,
    }) as Doc<'files'>;
  const team = { kind: 'team' } as TeamPrincipal;
  const glossup = { kind: 'client', clientId: 'glossup' } as unknown as ClientPrincipal;
  const qravit = { kind: 'client', clientId: 'qravit' } as unknown as ClientPrincipal;
  const rules = { tickets: { team: () => true, portal: () => true } } as never;

  it('denies every table without a rule', () => {
    expect(canReadFile(team, file({ owner: { table: 'contacts', id: 'c1' } }))).toBe(false);
    expect(canReadFile(glossup, file({ owner: { table: 'contacts', id: 'c1' } }))).toBe(false);
  });

  it('lets team members read the studio logo', () => {
    expect(canReadFile(team, file({ owner: { table: 'orgSettings', id: 's1' }, visibility: 'internal' }))).toBe(true);
  });

  it('keeps client users to their own client’s client-visible files, even when the module allows the portal', () => {
    expect(canReadFile(glossup, file({}), rules)).toBe(true);
    expect(canReadFile(qravit, file({}), rules)).toBe(false);
    expect(canReadFile(glossup, file({ visibility: 'internal' }), rules)).toBe(false);
    expect(canReadFile(glossup, file({ clientId: undefined }), rules)).toBe(false);
  });
});
