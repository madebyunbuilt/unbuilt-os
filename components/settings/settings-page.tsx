import { type ReactNode } from 'react';
import { getViewer } from '@/lib/viewer';

/** A settings section: the heading, and the form only when the role holds the permission the section needs. */
export async function SettingsPage({
  title,
  description,
  permission,
  children,
}: {
  title: string;
  description: string;
  permission: string;
  children: ReactNode;
}) {
  const viewer = await getViewer();
  const allowed = viewer?.permissions.includes(permission) ?? false;
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
