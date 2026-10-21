import { HomeCard } from '../components/HomeCard';
import { formatLabel } from '@repo/shared';

export default function Page() {
  return <HomeCard title={formatLabel('home')} />;
}
