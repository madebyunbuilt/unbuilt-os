import {
  Activity,
  Building2,
  ChartColumn,
  Clock,
  FileText,
  Folder,
  Globe,
  Handshake,
  House,
  Inbox,
  KeyRound,
  LifeBuoy,
  type LucideIcon,
  Receipt,
  Settings,
  Tag,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import { type NavIcon as NavIconName } from '@/lib/navigation';

const ICONS: Record<NavIconName, LucideIcon> = {
  home: House,
  inbox: Inbox,
  handshake: Handshake,
  building: Building2,
  folder: Folder,
  clock: Clock,
  file: FileText,
  receipt: Receipt,
  wallet: Wallet,
  truck: Truck,
  lifebuoy: LifeBuoy,
  activity: Activity,
  key: KeyRound,
  users: Users,
  globe: Globe,
  chart: ChartColumn,
  settings: Settings,
  tag: Tag,
};

export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  const Icon = ICONS[name];
  return <Icon className={className} aria-hidden />;
}
