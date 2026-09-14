import type { MetadataRoute } from 'next';
import { currentSurface } from '@/lib/viewer';

// One manifest per host, so the team app and the client portal install as separate apps with their own names.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const portal = (await currentSurface()) === 'portal';
  return {
    name: portal ? 'Unbuilt client portal' : 'Unbuilt OS',
    short_name: portal ? 'Unbuilt portal' : 'Unbuilt OS',
    description: portal
      ? 'Your projects, documents and invoices with Unbuilt Studio.'
      : "Unbuilt Studio's operating system.",
    id: portal ? '/?app=portal' : '/?app=team',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
