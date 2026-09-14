import { Mark } from '@/components/brand/mark';
import { currentSurface } from '@/lib/viewer';

export default async function AuthLayout({ children }: LayoutProps<'/'>) {
  const surface = await currentSurface();
  return (
    <div className="flex flex-1 flex-col px-4 py-10 sm:py-16">
      <header className="mx-auto flex w-full max-w-sm items-center gap-3">
        <Mark size={28} />
        <span className="font-display text-lg font-extrabold tracking-tight">
          {surface === 'portal' ? 'Unbuilt client portal' : 'Unbuilt OS'}
        </span>
      </header>
      <main className="mx-auto mt-12 w-full max-w-sm">{children}</main>
    </div>
  );
}
