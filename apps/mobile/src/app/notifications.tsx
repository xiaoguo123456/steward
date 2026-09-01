import { AppScreen } from '@/components/ui/app-screen';
import { NavHeader } from '@/components/ui/nav-header';
import { NotificationsContent } from '@/features/notifications/notifications-content';

export default function NotificationsScreen() {
  return (
    <AppScreen includeBottomInset>
      <NavHeader title="通知" />
      <NotificationsContent />
    </AppScreen>
  );
}
