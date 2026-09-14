import { type ReactNode } from 'react';
import { getViewer } from '@/lib/viewer';

/** A settings section: the heading, and the form only when the role holds a permission the section needs. */
export async function SettingsPage({
  title,
  description,
  permission,
  children,
}: {
  title: string;
  description: string;
  /** Any one of these shows the form; the form itself may be read-only for some of them. */
  permission: string | readonly string[];
  children: ReactNode;
}) {
  const viewer = await getViewer();
  const needed = typeof permission === 'string' ? [permission] : permission;
  const allowed = needed.some((key) => viewer?.permissions.includes(key));
  return (
    <section aria-labelledby="settings-section-heading">
      <h2 id="settings-section-heading" className="font-display text-2xl font-bold">
        {title}
      </h2>
      <p className="mt-1 max-w-prose text-muted-foreground">{description}</p>
      <div className="mt-8">
        {allowed ? (
          children
        ) : (
          <p role="alert" className="rounded-md border p-4 text-sm">
            Your role cannot change these settings. Ask an Admin or the Owner.
          </p>
        )}
      </div>
    </section>
  );
}
