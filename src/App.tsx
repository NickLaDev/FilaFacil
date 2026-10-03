import { lazy, Suspense, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { PROFILE_PATHS, profileFromPath, type Profile } from '@/app/profiles';

// Cada perfil vira um chunk separado: o cliente não baixa código dos painéis.
const PROFILE_APPS = {
  client: lazy(() => import('@/apps/client/ClientApp')),
  attendant: lazy(() => import('@/apps/attendant/AttendantApp')),
  manager: lazy(() => import('@/apps/manager/ManagerApp')),
  admin: lazy(() => import('@/apps/admin/AdminApp')),
};

// Ferramenta de desenvolvimento: não entra no build de produção.
const DevProfileSwitcher = import.meta.env.DEV ? lazy(() => import('@/dev/DevProfileSwitcher')) : null;

function resolveProfile(): Profile {
  const profile = profileFromPath(window.location.pathname);
  if (!profile) window.history.replaceState(null, '', PROFILE_PATHS.client);
  return profile ?? 'client';
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 size={28} className="text-primary animate-spin" aria-label="Carregando" />
    </div>
  );
}

export default function App() {
  const [profile, setProfile] = useState<Profile>(resolveProfile);

  useEffect(() => {
    const onPopState = () => setProfile(resolveProfile());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function switchProfile(next: Profile) {
    window.history.pushState(null, '', PROFILE_PATHS[next]);
    setProfile(next);
  }

  const ProfileApp = PROFILE_APPS[profile];

  return (
    <>
      <Suspense fallback={<LoadingScreen />}>
        {profile === 'client' ? (
          <div className="min-h-screen bg-background flex justify-center">
            <div className="w-full max-w-[390px] min-h-screen bg-card shadow-xl relative">
              <ProfileApp />
            </div>
          </div>
        ) : (
          <ProfileApp />
        )}
      </Suspense>
      {DevProfileSwitcher && (
        <Suspense fallback={null}>
          <DevProfileSwitcher active={profile} onChange={switchProfile} />
        </Suspense>
      )}
    </>
  );
}
