import { useEffect, useState } from 'react';
import { QrCode } from 'lucide-react';
import { BRAND } from '@/config/brand';
import { cn } from '@/lib/utils';
import { BrandAppIcon, BrandLogo } from '@/components/brand/Logo';
import { useClient } from '../clientContext';

export function SplashScreen() {
  const { go, account } = useClient();
  const [fading, setFading] = useState(false);
  const destination = account ? 'home-out-of-bar' : 'welcome';

  useEffect(() => {
    const fade = setTimeout(() => setFading(true), 1400);
    const next = setTimeout(() => go(destination), 1800);
    return () => {
      clearTimeout(fade);
      clearTimeout(next);
    };
  }, [go, destination]);

  return (
    <div className={cn('min-h-screen flex flex-col items-center justify-center gap-6 transition-opacity duration-400 bg-foreground', fading ? 'opacity-0' : 'opacity-100')}>
      <BrandAppIcon size={88} />
      <div className="text-center">
        <p className="font-display font-extrabold text-white text-2xl tracking-tight leading-none">{BRAND.name}</p>
        <p className="text-white/40 text-sm mt-1.5 font-body">{BRAND.tagline}</p>
      </div>
      <div className="flex gap-1.5 mt-2">
        {[0, 1, 2].map(i => (
          <div key={i} className="w-1.5 h-1.5 rounded-full bg-white/25 animate-pulse" style={{ animationDelay: `${i * 180}ms` }} />
        ))}
      </div>
    </div>
  );
}

export function WelcomeScreen() {
  const { go, continueAsVisitor } = useClient();
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex items-center justify-center pt-12 pb-6 flex-shrink-0">
        <BrandLogo size="lg" />
      </div>

      <div className="flex items-center justify-center px-10 py-2 flex-shrink-0">
        <svg viewBox="0 0 280 140" className="w-full max-w-xs" fill="none" aria-hidden="true">
          <rect x="20" y="70" width="240" height="50" rx="8" fill="#E8E3DC" />
          <rect x="40" y="50" width="60" height="30" rx="6" fill="#D4C9BC" />
          <rect x="120" y="40" width="80" height="40" rx="6" fill="#C4B9AC" />
          <rect x="210" y="55" width="50" height="25" rx="6" fill="#D4C9BC" />
          <rect x="108" y="22" width="64" height="38" rx="7" fill="white" stroke="#E8700A" strokeWidth="2" />
          <rect x="116" y="30" width="34" height="4" rx="2" fill="#E8700A" opacity="0.7" />
          <rect x="116" y="38" width="26" height="4" rx="2" fill="#E8700A" opacity="0.4" />
          <rect x="116" y="46" width="18" height="4" rx="2" fill="#E8700A" opacity="0.25" />
          <circle cx="163" cy="24" r="10" fill="#16A34A" />
          <path d="M158 24 L162 28 L168 20" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <div className="px-8 pt-4 text-center">
        <h1 className="font-display font-extrabold text-foreground text-3xl leading-tight tracking-tight">
          Peça. Acompanhe.<br />Retire.
        </h1>
        <p className="text-muted-foreground mt-3 leading-relaxed text-sm">Faça seu pedido pelo celular e deixe a fila com a gente.</p>
      </div>

      <div className="flex flex-col px-6 mt-auto pb-10 pt-6 gap-3">
        <button
          onClick={() => go('qr-scanner')}
          className="w-full bg-primary text-primary-foreground font-display font-semibold py-4 rounded-xl flex items-center justify-center gap-2"
        >
          <QrCode size={18} />
          Escanear QR Code
        </button>
        <button onClick={() => go('login')} className="w-full bg-card border border-border text-foreground font-display font-semibold py-3.5 rounded-xl">
          Entrar
        </button>
        <p className="text-center text-sm text-muted-foreground">
          Ainda não tem conta?{' '}
          <button onClick={() => go('signup-name')} className="text-foreground font-semibold underline underline-offset-2">Criar conta</button>
        </p>
        <button
          onClick={() => continueAsVisitor('home-out-of-bar')}
          className="text-center text-muted-foreground text-xs hover:text-foreground transition-colors py-1"
        >
          Explorar restaurantes
        </button>
      </div>
    </div>
  );
}
