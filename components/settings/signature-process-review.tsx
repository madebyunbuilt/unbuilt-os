'use client';

import { useMutation, useQuery } from 'convex/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/convex/_generated/api';
import { errorMessage } from '@/lib/convex-error';

// 07-documents-and-esign.md, Legal note: Nigeria's Evidence Act 2011 recognises electronic signatures, but the process
// should be reviewed by counsel. This stays off until the Owner records that it has been.

const reviewedOn = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long' });

export function SignatureProcessReview({ isOwner }: { isOwner: boolean }) {
  const review = useQuery(api.settings.signatureProcessReview, {});
  const setReview = useMutation(api.settings.setSignatureProcessReview);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (review === undefined) return null;

  const save = async (reviewed: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await setReview({ reviewed, note: reviewed ? note || undefined : undefined });
      setNote('');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="signature-review-heading" className="space-y-3 rounded-lg border p-4">
      <h3 id="signature-review-heading" className="font-medium">
        The signing process
      </h3>
      {review.reviewed ? (
        <p className="text-sm">
          Counsel reviewed the signing process — the emailed code, the consent statement, the evidence recorded and the
          certificate — recorded by {review.reviewedByName} on {reviewedOn.format(review.reviewedAt)}
          {review.note ? ` (${review.note})` : ''}.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Not yet reviewed by counsel. Electronic signatures are recognised under Nigeria&rsquo;s Evidence Act 2011, but
          the studio&rsquo;s lawyer should confirm the process before contracts are signed this way.
        </p>
      )}
      {isOwner ? (
        review.reviewed ? (
          <Button type="button" variant="ghost" disabled={saving} onClick={() => void save(false)}>
            Withdraw this
          </Button>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="signature-review-note" className="text-xs text-muted-foreground">
                Who reviewed it (optional)
              </Label>
              <Input
                id="signature-review-note"
                placeholder="Okafor & Co"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            <Button type="button" variant="outline" disabled={saving} onClick={() => void save(true)}>
              Record that counsel reviewed it
            </Button>
          </div>
        )
      ) : (
        <p className="text-sm text-muted-foreground">Only the Owner can record this.</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
