import ActivityLog from '@/frontend/components/ActivityLog';
import PageHeader from '@/frontend/components/ui/PageHeader';

export default function ActivityRoute() {
  return (
    <>
      <PageHeader>Activity</PageHeader>
      <ActivityLog />
    </>
  );
}
