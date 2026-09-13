# 10 — Credentials vault

Clients hand over logins for hosting, domains, app stores, analytics and third-party services. The vault replaces
sending them in chat or email.

## Storage

- Secrets are encrypted before they are written. Only ciphertext, IV and key version reach the database.
- Algorithm: AES-256-GCM with a random 96-bit IV per field.
- Encryption and decryption run only in `"use node"` internal actions in `convex/lib/crypto.ts`.
- The key comes from the Convex environment variable `VAULT_KEY_v<n>` (32 random bytes, base64). `VAULT_ACTIVE_KEY_VERSION`
  names the key used for new writes. Old keys stay available for decryption until rotation completes.
- **Key rotation** is an internal action that re-encrypts every item with the active key and records progress. It runs
  in batches and is resumable.
- Labels, kind, URL and project are stored in plaintext so items can be listed and searched without decryption.
- Plaintext is never logged, never included in audit diffs, never returned by a query, and never stored in notifications
  or emails.

## Access

- `vault.view.assigned`: items on projects the member belongs to. `vault.view.all`: every item. `vault.manage`: create,
  edit, delete.
- Listing items returns metadata only.
- **Reveal** is an action that:
  1. checks permission and project scope
  2. decrypts
  3. returns the plaintext for display
  4. writes a `vaultAccessLogs` entry and an audit entry
- The UI hides the value again after 30 seconds. Copy to clipboard is logged as `copy`.
- Revealing requires a 2FA session verified within the last 15 minutes; otherwise the member re-enters their TOTP code.
- Clients never read vault items. With `portal.vault.submit` they can submit credentials: the portal form posts to an
  action that encrypts immediately. Clients then see their own submitted items' labels and dates only.

## Lifecycle

- Items can have a `rotateByDate`; reminders go to the project manager 7 days before and on the date.
- When a member leaves a project, the project manager is prompted to rotate credentials that member revealed (from the
  access log).
- At handover, items can be marked handed over and archived; archived items are deleted after the retention period unless
  a legal hold is set.
- Deleting an item removes the ciphertext; the access log is kept.

## Acceptance criteria

- The database contains no plaintext secret, proven by a test that creates an item and scans the stored document.
- A member not on the project cannot reveal an item, and the attempt is logged.
- Every reveal and copy creates exactly one access log entry and one audit entry.
- Reveal without a recent 2FA verification requires re-verification.
- No portal function returns vault secrets; client submissions are encrypted before storage.
- Key rotation re-encrypts all items and every item still decrypts afterwards.
