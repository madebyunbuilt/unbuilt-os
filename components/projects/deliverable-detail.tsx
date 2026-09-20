'use client';

import { useMutation, useQuery } from 'convex/react';
import { ArrowLeft, Download, Paperclip, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { uploadToStorage } from '@/components/app/image-upload-field';
import { CommentsThread } from '@/components/projects/comments-thread';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { FILE_CONTEXTS } from '@/convex/lib/files';
import { errorMessage } from '@/lib/convex-error';
import { deliverableStatus, formatBytes } from '@/lib/projects-display';

// One deliverable: its versions, the form to submit a new one, and its comments (06-projects.md, Review flow).

const ALLOWED_TYPES = Object.keys(FILE_CONTEXTS.deliverable.types);
const MAX_BYTES = FILE_CONTEXTS.deliverable.maxBytes;
const MAX_FILES = 20;

const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export function DeliverableDetail({
  deliverableId,
  permissions,
}: {
  deliverableId: Id<'deliverables'>;
  permissions: string[];
}) {
  const deliverable = useQuery(api.deliverables.get, { deliverableId });
  const remove = useMutation(api.deliverables.remove);
  const router = useRouter();
  const canManage = permissions.includes('deliverables.manage.assigned');

  if (deliverable === undefined) return <p className="text-muted-foreground">Loading the deliverable…</p>;

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <Link
          href={`/projects/${deliverable.projectId}/milestones`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Milestones and deliverables
        </Link>
        <header className="flex flex-wrap items-start gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-3xl font-bold">{deliverable.title}</h1>
              <ToneBadge {...deliverableStatus(deliverable.status)} />
            </div>
            <p className="mt-1 text-muted-foreground">
              {deliverable.milestone ? deliverable.milestone.name : 'No milestone'}
              {deliverable.currentVersion > 0 && ` · version ${deliverable.currentVersion}`}
            </p>
            {deliverable.approvedAt !== undefined && (
              <p className="mt-1 text-sm text-muted-foreground">
                Approved by {deliverable.approvedByName ?? 'the client'} on{' '}
                <time dateTime={new Date(deliverable.approvedAt).toISOString()}>
                  {dateTime.format(deliverable.approvedAt)}
                </time>
                {deliverable.approvedVersion !== undefined && ` · version ${deliverable.approvedVersion}`}
              </p>
            )}
          </div>
          {canManage && deliverable.currentVersion === 0 && (
            <div className="sm:ml-auto">
              <ConfirmDialog
                trigger={<Button variant="outline">Delete</Button>}
                title={`Delete ${deliverable.title}?`}
                description="It has no submitted versions, so nothing is lost."
                confirmLabel="Delete"
                onConfirm={async () => {
                  await remove({ deliverableId });
                  router.push(`/projects/${deliverable.projectId}/milestones`);
                }}
              />
            </div>
          )}
        </header>
        {deliverable.description && <p className="whitespace-pre-wrap">{deliverable.description}</p>}
      </div>

      {canManage && deliverable.status !== 'approved' && <SubmitVersionForm deliverableId={deliverableId} />}

      <section className="space-y-4">
        <h2 className="font-display text-xl font-bold">Versions</h2>
        {deliverable.versions.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-muted-foreground">
            Nothing submitted yet. The client sees a deliverable once its first version is submitted.
          </p>
        ) : (
          <ol className="space-y-4">
            {deliverable.versions.map((version) => (
              <li key={version.version} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <h3 className="font-medium">Version {version.version}</h3>
                  <p className="text-sm text-muted-foreground">
                    {version.submittedByName} ·{' '}
                    <time dateTime={new Date(version.submittedAt).toISOString()}>
                      {dateTime.format(version.submittedAt)}
                    </time>
                  </p>
                </div>
                {version.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{version.notes}</p>}
                {version.files.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {version.files.map((file) => (
                      <li key={file.id}>
                        <FileDownload fileId={file.id} name={file.name} sizeBytes={file.sizeBytes} />
                      </li>
                    ))}
                  </ul>
                )}
                {version.links.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm">
                    {version.links.map((link) => (
                      <li key={link.url}>
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="underline underline-offset-4"
                        >
                          {link.label ?? link.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <CommentsThread
        target={{ table: 'deliverables', id: deliverableId }}
        canMention={permissions.includes('team.view')}
      />
    </div>
  );
}

/** Asks for a signed download link when the person asks for the file, and starts the download when it arrives. */
function FileDownload({ fileId, name, sizeBytes }: { fileId: Id<'files'>; name: string; sizeBytes: number }) {
  const [wanted, setWanted] = useState(false);
  const started = useRef(false);
  const link = useQuery(api.files.teamDownloadUrl, wanted ? { fileId } : 'skip');

  useEffect(() => {
    if (link && !started.current) {
      started.current = true;
      window.location.href = link.url;
    }
  }, [link]);

  return (
    <Button variant="ghost" size="sm" disabled={wanted} onClick={() => setWanted(true)}>
      <Download aria-hidden />
      {name}
      <span className="text-muted-foreground">{wanted && !link ? 'Preparing…' : formatBytes(sizeBytes)}</span>
    </Button>
  );
}

type Pending = { file: File; storageId: string };

function SubmitVersionForm({ deliverableId }: { deliverableId: Id<'deliverables'> }) {
  const generateUploadUrl = useMutation(api.deliverables.generateUploadUrl);
  const submit = useMutation(api.deliverables.submitVersion);
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Pending[]>([]);
  const [links, setLinks] = useState<{ label: string; url: string }[]>([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (chosen.length === 0) return;
    if (files.length + chosen.length > MAX_FILES) {
      setError(`Up to ${MAX_FILES} files in one version.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const uploaded: Pending[] = [];
      for (const file of chosen) {
        if (!ALLOWED_TYPES.includes(file.type)) {
          setError(`${file.name} is a type of file that cannot be uploaded here.`);
          break;
        }
        if (file.size > MAX_BYTES) {
          setError(`${file.name} is larger than ${MAX_BYTES / (1024 * 1024)} MB.`);
          break;
        }
        uploaded.push({ file, storageId: await uploadToStorage(await generateUploadUrl({}), file) });
      }
      setFiles((current) => [...current, ...uploaded]);
    } catch (caught) {
      setError(errorMessage(caught, 'The file could not be uploaded. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-4 rounded-lg border p-4"
      aria-label="Submit a version"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        setDone(null);
        try {
          const result = await submit({
            deliverableId,
            uploads: files.map((pending) => ({
              storageId: pending.storageId as Id<'_storage'>,
              name: pending.file.name,
              contentType: pending.file.type,
            })),
            links: links
              .filter((link) => link.url.trim())
              .map((link) => ({ label: link.label || undefined, url: link.url })),
            notes: notes || undefined,
          });
          if (!result.ok) {
            setError(result.message);
            setFiles([]);
            return;
          }
          setFiles([]);
          setLinks([]);
          setNotes('');
          setDone(result.version);
        } catch (caught) {
          setError(errorMessage(caught));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <h2 className="font-display text-lg font-bold">Submit a version</h2>
        <p className="text-sm text-muted-foreground">
          The deliverable goes to the client for review, and its milestone waits for approval.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="deliverable-files">Files</Label>
        <input
          ref={input}
          id="deliverable-files"
          type="file"
          multiple
          className="sr-only"
          accept={ALLOWED_TYPES.join(',')}
          onChange={(event) => void onFiles(event)}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
            <Paperclip aria-hidden />
            {busy ? 'Working…' : 'Add files'}
          </Button>
        </div>
        {files.length > 0 && (
          <ul className="space-y-1 text-sm">
            {files.map((pending, index) => (
              <li key={pending.storageId} className="flex items-center gap-2">
                <span>
                  {pending.file.name} <span className="text-muted-foreground">{formatBytes(pending.file.size)}</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${pending.file.name}`}
                  onClick={() => setFiles((current) => current.filter((_, at) => at !== index))}
                >
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-muted-foreground">
          Images, documents and zip archives, up to {MAX_BYTES / (1024 * 1024)} MB each.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="deliverable-link-url-0">Links</Label>
        {links.map((link, index) => (
          <div key={index} className="flex flex-wrap gap-2">
            <Input
              aria-label={`Link ${index + 1} label`}
              placeholder="Label (optional)"
              className="sm:w-48"
              value={link.label}
              onChange={(event) =>
                setLinks((current) =>
                  current.map((row, at) => (at === index ? { ...row, label: event.target.value } : row)),
                )
              }
            />
            <Input
              id={`deliverable-link-url-${index}`}
              aria-label={`Link ${index + 1} address`}
              placeholder="https://"
              className="sm:flex-1"
              value={link.url}
              onChange={(event) =>
                setLinks((current) =>
                  current.map((row, at) => (at === index ? { ...row, url: event.target.value } : row)),
                )
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove link ${index + 1}`}
              onClick={() => setLinks((current) => current.filter((_, at) => at !== index))}
            >
              <X aria-hidden />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setLinks((current) => [...current, { label: '', url: '' }])}
        >
          Add a link
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="deliverable-notes">Notes (optional)</Label>
        <Textarea id="deliverable-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {done !== null && <p className="text-sm text-muted-foreground">Version {done} is with the client.</p>}

      <Button type="submit" disabled={busy || (files.length === 0 && links.every((link) => !link.url.trim()))}>
        {busy ? 'Submitting…' : 'Submit for review'}
      </Button>
    </form>
  );
}
