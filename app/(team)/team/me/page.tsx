import type { Metadata } from 'next';
import { MyProfile } from '@/components/team/my-profile';

export const metadata: Metadata = { title: 'My profile' };

export default function MyProfilePage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
      <MyProfile />
    </div>
  );
}
