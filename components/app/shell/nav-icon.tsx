import {
  Activity,
  Building2,
  ChartColumn,
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
};

export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  const Icon = ICONS[name];
  return <Icon className={className} aria-hidden />;
}
