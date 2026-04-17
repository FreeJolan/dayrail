import { TodayTrack } from './pages/TodayTrack';
import { SideNav } from './components/SideNav';

export default function App() {
  return (
    <div className="flex min-h-screen w-full bg-surface-0">
      <SideNav />
      <main className="flex-1">
        <TodayTrack />
      </main>
    </div>
  );
}
