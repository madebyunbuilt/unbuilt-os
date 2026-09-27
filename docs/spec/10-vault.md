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
  in batches and is resumable: the cursor lives on the run, so an interrupted rotation restarts from where it stopped.
  Two runs cannot go at once. An item that will not decrypt is counted and left exactly as it was, never blanked or
  deleted — the ciphertext is the only copy of that secret, so a key that cannot read it is a reason to find the right
  key. The old key therefore stays set until that count is zero.
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

- Items can have a `rotateByDate`; reminders go to the project manager 7 days before and on the date. An item held
  against the client as a whole has no project manager, so it goes to the client's owner, and to everyone with
  `vault.view.all` if the client has no owner: a reminder nobody receives is the one failure this must not have.
- Which milestone was last sent is stored as its own date rather than a flag, so a day the cron did not run is caught up
  instead of skipped. When both milestones are due at once, only the nearer one is sent.
- When a member leaves a project, the project manager is prompted to rotate credentials that member revealed (from the
  access log). Revealed, not merely reachable: the prompt is a list of credentials to change, and padding it with items
  nobody opened is how it starts being ignored. The prompt notifies and does not rotate anything, because the credential
  lives in somebody else's system and has to be changed there first.
- At handover, items can be marked handed over and archived; archived items are deleted after the retention period unless
  a legal hold is set.
- Handed over says the client holds this credential now; the studio's copy still opens, because it is still the record of
  what was handed over. Archived takes an item out of every list and starts the retention clock, and is not a delete: an
  archived item can be restored. Nothing else about an archived item can be edited until it is, so an archive stays a
  record of what was.
- Changing the secret replaces the old ciphertext rather than keeping it beside the new one: a vault holding every
  previous password would be a worse thing to lose than one holding the current one. It clears `rotateByDate`, since the
  reminder has been answered, and records who rotated it and when.
- `vault.manage` is permission to edit the vault, not permission to see more of it. An item a member could not reveal is
  one they cannot edit, and the refusal says what a missing item says, so editing cannot be used to discover which
  credentials exist.
- Deleting an item removes the ciphertext; the access log is kept.

## Acceptance criteria

- The database contains no plaintext secret, proven by a test that creates an item and scans the stored document.
- A member not on the project cannot reveal an item, and the attempt is logged.
- Every reveal and copy creates exactly one access log entry and one audit entry.
- Reveal without a recent 2FA verification requires re-verification.
- No portal function returns vault secrets; client submissions are encrypted before storage.
- Key rotation re-encrypts all items and every item still decrypts afterwards.
