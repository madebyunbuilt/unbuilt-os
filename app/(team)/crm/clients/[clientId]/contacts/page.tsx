import type { Metadata } from 'next';
import { ContactsPanel } from '@/components/crm/contacts-panel';
import { type Id } from '@/convex/_generated/dataModel';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Contacts' };

export default async function ClientContactsPage({ params }: PageProps<'/crm/clients/[clientId]/contacts'>) {
  const { clientId } = await params;
  const permissions = (await getViewer())?.permissions ?? [];
  return <ContactsPanel clientId={clientId as Id<'clients'>} permissions={permissions} />;
}
