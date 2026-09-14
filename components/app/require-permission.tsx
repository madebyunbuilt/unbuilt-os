import { type ReactNode } from 'react';

/** A page's content, or a plain explanation when the role holds none of the permissions it needs. */
export function RequirePermission({
  permissions,
  anyOf,
  what,
  children,
}: {
  permissions: readonly string[];
  anyOf: readonly string[];
  /** What the page shows, for the message: "clients". */
  what: string;
  children: ReactNode;
}) {
  if (anyOf.some((key) => permissions.includes(key))) return children;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
      <p role="alert" className="rounded-md border p-4">
        Your role cannot view {what}. Ask an Admin or the Owner if you need access.
      </p>
    </div>
  );
}
