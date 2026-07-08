import CommitteeAdmin from '@/components/committee/CommitteeAdmin';
import PinGate from '@/components/PinGate';

export const metadata = { title: 'Committee Admin — Trinity World Water Consumption' };

export default function AdminPage() {
  return (
    <PinGate>
      <CommitteeAdmin />
    </PinGate>
  );
}
