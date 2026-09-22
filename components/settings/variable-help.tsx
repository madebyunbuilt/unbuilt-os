'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { VARIABLES } from '@/convex/lib/documentBlocks';

// The variables a template or clause may use. The server refuses anything else, so the list is offered here rather than
// left to guesswork; copying one puts it on the clipboard ready to paste.

const GROUPS: { label: string; prefix: string }[] = [
  { label: 'The client', prefix: 'client.' },
  { label: 'The contact it is addressed to', prefix: 'contact.' },
  { label: 'The project', prefix: 'project.' },
  { label: 'The deal', prefix: 'deal.' },
  { label: 'The studio', prefix: 'org.' },
  { label: 'The document', prefix: 'document.' },
  { label: 'Money', prefix: 'totals.' },
  { label: 'Payment', prefix: 'schedule.' },
];

export function VariableHelp() {
  const [copied, setCopied] = useState<string | null>(null);
  const names = Object.keys(VARIABLES);
  const ungrouped = names.filter((name) => !name.includes('.'));

  const copy = async (name: string) => {
    try {
      await navigator.clipboard.writeText(`{{${name}}}`);
      setCopied(name);
    } catch {
      // A browser without clipboard access still shows the name to type.
    }
  };

  return (
    <details className="rounded-md border p-3 text-sm">
      <summary className="cursor-pointer font-medium">Variables you can use</summary>
      <p className="mt-2 text-muted-foreground">
        Anything written as {'{{name}}'} is filled in when the document is read or sent. Anything not on this list is
        refused when you save.
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {[...GROUPS, { label: 'Dates', prefix: '' }].map((group) => {
          const members = group.prefix ? names.filter((name) => name.startsWith(group.prefix)) : ungrouped;
          if (members.length === 0) return null;
          return (
            <div key={group.label}>
              <p className="font-medium">{group.label}</p>
              <ul className="mt-1 space-y-1">
                {members.map((name) => (
                  <li key={name} className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => void copy(name)}
                      className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs hover:bg-accent"
                      aria-label={`Copy {{${name}}}`}
                    >
                      {copied === name ? (
                        <Check aria-hidden className="size-3" />
                      ) : (
                        <Copy aria-hidden className="size-3" />
                      )}
                      {`{{${name}}}`}
                    </button>
                    <span className="text-muted-foreground">{VARIABLES[name]}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </details>
  );
}
