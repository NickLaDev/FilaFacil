import { useRef, useState } from 'react';
import { AlertTriangle, Camera, QrCode, RefreshCw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRestaurantData } from '@/services/restaurantService';
import BottomSheet from '@/components/ui/BottomSheet';
import { useClient } from '../clientContext';
import { BackButton } from '../components/Layout';
import { useQrScanner } from '../hooks/useQrScanner';
import { useQrResolver } from '../hooks/useQrResolver';
import type { TableContext } from '../types';

const DEMO_CODES = { valid: 'MESTRE-1041', closed: 'CANTINA-1201', invalid: 'XYZ-0000' };

function useExitScanner() {
  const { go, account, isVisitor, table } = useClient();
  return () => go(!account && !isVisitor ? 'welcome' : table ? 'home-in-bar' : 'home-out-of-bar');
}

function SwitchRestaurantSheet({ target, onConfirm, onCancel }: { target: TableContext; onConfirm: () => void; onCancel: () => void }) {
  const { cartEstablishmentId } = useClient();
  const current = useRestaurantData(cartEstablishmentId);
  const next = useRestaurantData(target.establishmentId);
  return (
    <BottomSheet onClose={onCancel}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center flex-shrink-0">
          <AlertTriangle size={18} className="text-warning" />
        </div>
        <div>
          <p className="font-display font-bold text-foreground">Trocar de restaurante?</p>
          <p className="text-xs text-muted-foreground">Você está em: {current?.name}</p>
        </div>
      </div>
      <p className="text-sm text-muted-foreground mb-2">
        Seu carrinho atual pertence ao <strong className="text-foreground">{current?.name}</strong>. Para entrar em{' '}
        <strong className="text-foreground">{next?.name}</strong>, o carrinho será esvaziado.
      </p>
      <div className="bg-muted rounded-xl px-4 py-3 mb-5 flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">{next?.name}</span>
        <span className="text-muted-foreground text-xs">· {target.tableLabel}</span>
      </div>
      <div className="flex flex-col gap-2">
        <button onClick={onConfirm} className="w-full bg-primary text-primary-foreground font-display font-semibold py-4 rounded-xl">
          Esvaziar carrinho e entrar
        </button>
        <button onClick={onCancel} className="w-full bg-muted text-foreground font-display font-semibold py-4 rounded-xl">
          Continuar no {current?.name}
        </button>
      </div>
    </BottomSheet>
  );
}

export function QRScannerScreen() {
  const { go } = useClient();
  const exit = useExitScanner();
  const { resolve, pendingSwitch, confirmSwitch, cancelSwitch } = useQrResolver();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [simulating, setSimulating] = useState(false);
  const scanner = useQrScanner(videoRef, code => void resolve(code), !pendingSwitch);

  function simulate(code: string) {
    setSimulating(true);
    setTimeout(() => {
      void resolve(code).finally(() => setSimulating(false));
    }, 1000);
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      {pendingSwitch && <SwitchRestaurantSheet target={pendingSwitch} onConfirm={confirmSwitch} onCancel={cancelSwitch} />}

      <div className="flex items-center justify-between px-4 pt-5 pb-3">
        <button onClick={exit} className="p-2 rounded-full bg-white/10" aria-label="Voltar">
          <X size={18} className="text-white" />
        </button>
        <p className="font-display font-semibold text-white">Escanear QR Code</p>
        <div className="w-9" />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-8 gap-6">
        <div className="relative w-full max-w-[280px] aspect-square">
          <div className="absolute inset-0 rounded-2xl overflow-hidden bg-[#1a1a1a]">
            <video ref={videoRef} muted playsInline className={cn('w-full h-full object-cover', scanner !== 'scanning' && 'hidden')} />
            {scanner !== 'scanning' && (
              <img
                src="https://images.unsplash.com/photo-1606889464198-fcb18894cf50?w=400&h=400&fit=crop&auto=format"
                alt=""
                className="w-full h-full object-cover opacity-40 blur-sm"
              />
            )}
          </div>
          {(['tl', 'tr', 'bl', 'br'] as const).map(position => (
            <div
              key={position}
              className={cn(
                'absolute w-7 h-7 border-primary',
                position === 'tl' && 'top-0 left-0 border-t-[3px] border-l-[3px] rounded-tl-lg',
                position === 'tr' && 'top-0 right-0 border-t-[3px] border-r-[3px] rounded-tr-lg',
                position === 'bl' && 'bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-lg',
                position === 'br' && 'bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-lg',
              )}
            />
          ))}
          {(scanner === 'scanning' || simulating) && (
            <div className="absolute left-3 right-3 h-0.5 bg-primary shadow-[0_0_8px_2px_rgba(232,112,10,0.6)] animate-bounce" style={{ top: '50%' }} />
          )}
          {scanner !== 'scanning' && !simulating && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
              {scanner === 'starting' ? <Camera size={40} className="text-white/30 animate-pulse" /> : <QrCode size={60} className="text-white/20" />}
            </div>
          )}
          {simulating && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-primary text-sm font-medium animate-pulse">Lendo...</p>
            </div>
          )}
        </div>

        {scanner === 'denied' || scanner === 'unsupported' ? (
          <div className="bg-warning-bg border border-warning/20 rounded-xl p-4 w-full">
            <p className="text-sm text-warning font-medium">{scanner === 'denied' ? 'Câmera bloqueada' : 'Leitura pela câmera indisponível'}</p>
            <p className="text-xs text-warning/80 mt-1 leading-relaxed">
              {scanner === 'denied'
                ? 'Abra as configurações do navegador e permita o acesso à câmera para este site.'
                : 'Este navegador não lê QR Code pela câmera. Digite o código impresso na mesa.'}
            </p>
          </div>
        ) : (
          <p className="text-white/70 text-sm text-center leading-relaxed">Aponte para o QR Code disponível na sua mesa ou no bar</p>
        )}

        {import.meta.env.DEV && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 w-full">
            <p className="text-white/40 text-xs text-center mb-3">Dev · simulação de leitura</p>
            <div className="flex gap-2">
              <button onClick={() => simulate(DEMO_CODES.valid)} disabled={simulating} className="flex-1 bg-success/20 text-success text-xs font-medium py-2.5 rounded-xl disabled:opacity-50">QR válido</button>
              <button onClick={() => simulate(DEMO_CODES.invalid)} disabled={simulating} className="flex-1 bg-error/20 text-error text-xs font-medium py-2.5 rounded-xl disabled:opacity-50">QR inválido</button>
              <button onClick={() => simulate(DEMO_CODES.closed)} disabled={simulating} className="flex-1 bg-warning/20 text-warning text-xs font-medium py-2.5 rounded-xl disabled:opacity-50">Bar fechado</button>
            </div>
          </div>
        )}

        <button onClick={() => go('manual-code')} className="text-white/50 text-sm text-center">
          Não consegue escanear? <span className="text-primary font-medium">Digitar código</span>
        </button>
      </div>
    </div>
  );
}

export function ManualCodeScreen() {
  const { go } = useClient();
  const { resolve, pendingSwitch, confirmSwitch, cancelSwitch } = useQrResolver();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleContinue() {
    setLoading(true);
    const found = await resolve(code, { invalidScreen: false });
    setLoading(false);
    if (!found) setError('Não encontramos esse código. Confira e tente novamente.');
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {pendingSwitch && <SwitchRestaurantSheet target={pendingSwitch} onConfirm={confirmSwitch} onCancel={cancelSwitch} />}
      <div className="px-5 pt-5">
        <BackButton onClick={() => go('qr-scanner')} />
      </div>
      <div className="flex-1 flex flex-col px-6 py-6 gap-6">
        <div>
          <h1 className="font-display font-bold text-foreground text-2xl">Digite o código da mesa</h1>
          <p className="text-muted-foreground text-sm mt-1">O código está impresso abaixo do QR Code</p>
        </div>
        <div>
          <input
            value={code}
            onChange={event => { setCode(event.target.value.toUpperCase().slice(0, 20)); setError(''); }}
            placeholder="MESTRE-0000"
            aria-label="Código da mesa"
            className={cn(
              'w-full bg-card border-2 rounded-xl px-4 py-4 text-xl font-display font-bold text-foreground text-center tracking-widest focus:outline-none focus:border-primary transition-colors',
              error ? 'border-error' : 'border-border',
            )}
          />
          {error && <p className="text-error text-xs mt-2">{error}</p>}
          {import.meta.env.DEV && (
            <p className="text-xs text-muted-foreground text-center mt-2">
              Dev: use <strong className="text-foreground">{DEMO_CODES.valid}</strong>
            </p>
          )}
        </div>
        <div className="mt-auto">
          <button
            onClick={handleContinue}
            disabled={!code.trim() || loading}
            className="w-full bg-primary text-primary-foreground font-display font-semibold py-4 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Buscando...' : 'Continuar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function QRInvalidScreen() {
  const { go } = useClient();
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-5 px-8">
      <div className="w-20 h-20 rounded-2xl bg-error-bg flex items-center justify-center">
        <X size={36} className="text-error" />
      </div>
      <div className="text-center">
        <h1 className="font-display font-bold text-foreground text-xl">QR Code inválido</h1>
        <p className="text-muted-foreground text-sm mt-2 leading-relaxed">
          Esse código não pertence a um estabelecimento válido ou não está mais ativo.
        </p>
      </div>
      <div className="w-full flex flex-col gap-3">
        <button
          onClick={() => go('qr-scanner')}
          className="w-full bg-primary text-primary-foreground font-display font-semibold py-4 rounded-xl flex items-center justify-center gap-2"
        >
          <RefreshCw size={16} />
          Escanear novamente
        </button>
        <button onClick={() => go('manual-code')} className="w-full border border-border text-foreground font-medium py-3.5 rounded-xl text-sm">
          Digitar código
        </button>
      </div>
    </div>
  );
}

function useTableEstablishment() {
  const { table } = useClient();
  return useRestaurantData(table?.establishmentId);
}

export function BarClosedScreen() {
  const { go, setTable, openMenu } = useClient();
  const establishment = useTableEstablishment();
  if (!establishment) return null;
  const paused = establishment.orderingStatus === 'paused';

  function scanAnother() {
    setTable(null);
    go('qr-scanner');
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="px-5 pt-5">
        <BackButton onClick={scanAnother} />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-8 gap-6">
        <div className="w-full bg-card border border-border rounded-2xl overflow-hidden">
          <div className="h-28 relative">
            <img src={establishment.images[0]} alt={establishment.name} className="w-full h-full object-cover opacity-50" />
            <div className="absolute inset-0 flex items-end px-5 pb-4">
              <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
                <span className="font-display font-bold text-white text-sm">{establishment.name[0]}</span>
              </div>
            </div>
          </div>
          <div className="p-5">
            <h2 className="font-display font-bold text-foreground text-lg">{establishment.name}</h2>
            <p className="text-muted-foreground text-sm">{establishment.address}</p>
            <div className="flex items-center gap-2 mt-3">
              <div className="w-2 h-2 rounded-full bg-error" />
              <span className="text-error text-sm font-medium">{paused ? 'Pedidos pausados' : 'Pedidos fechados'}</span>
            </div>
            <p className="text-muted-foreground text-sm mt-2">Novos pedidos estão temporariamente indisponíveis.</p>
            <div className="mt-3 bg-muted rounded-xl px-4 py-3">
              <p className="text-sm text-muted-foreground">{establishment.hoursLabel}</p>
            </div>
          </div>
        </div>

        <div className="w-full flex flex-col gap-3">
          <button onClick={() => openMenu(establishment.id)} className="w-full bg-card border border-border text-foreground font-medium py-3.5 rounded-xl text-sm">
            Ver cardápio <span className="text-muted-foreground ml-1">· somente consulta</span>
          </button>
          <button onClick={scanAnother} className="text-muted-foreground text-sm text-center">Escanear outro QR Code</button>
        </div>
      </div>
    </div>
  );
}

export function BarConfirmScreen() {
  const { go, table, setTable, account, isVisitor } = useClient();
  const establishment = useTableEstablishment();
  if (!establishment || !table) return null;

  function notThisBar() {
    setTable(null);
    go('qr-scanner');
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="px-5 pt-5">
        <BackButton onClick={notThisBar} />
      </div>
      <div className="flex-1 flex flex-col px-5 py-4 gap-5">
        <p className="text-sm text-muted-foreground text-center">QR Code lido com sucesso</p>
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="h-36 relative">
            <img src={establishment.images[0]} alt={establishment.name} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent" />
            <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
              <div>
                <h2 className="font-display font-bold text-white text-xl">{establishment.name}</h2>
                <p className="text-white/70 text-xs">{establishment.address}</p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-primary border-2 border-white flex items-center justify-center flex-shrink-0">
                <span className="font-display font-bold text-white">{establishment.name[0]}</span>
              </div>
            </div>
          </div>
          <div className="p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
                <span className="text-success text-sm font-medium">Aceitando pedidos</span>
              </div>
              <span className="bg-primary/10 text-primary text-xs font-bold px-3 py-1.5 rounded-full">{table.tableLabel}</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span aria-hidden="true">⏱</span>
              <span>Tempo estimado atual: <strong className="text-foreground">{establishment.avgTime}</strong></span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 mt-auto">
          <button
            onClick={() => go(account || isVisitor ? 'home-in-bar' : 'qr-auth-sheet')}
            className="w-full bg-primary text-primary-foreground font-display font-semibold py-4 rounded-xl text-base"
          >
            Entrar no bar
          </button>
          <button onClick={notThisBar} className="text-muted-foreground text-sm text-center">Não é este bar</button>
        </div>
      </div>
    </div>
  );
}

export function QRAuthSheet() {
  const { go, table, setPostAuthScreen, continueAsVisitor } = useClient();
  const establishment = useTableEstablishment();

  function authenticate(screen: 'login' | 'signup-name') {
    setPostAuthScreen('home-in-bar');
    go(screen);
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 relative">
        <img src={establishment?.images[0]} alt="" className="w-full h-full object-cover opacity-30 absolute inset-0" />
        <div className="absolute inset-0 flex items-end">
          <div className="w-full bg-card rounded-t-3xl p-6 shadow-2xl pb-10 flex flex-col gap-5">
            <div className="w-10 h-1 rounded-full bg-border mx-auto -mt-1" />
            <div>
              <p className="text-xs text-muted-foreground text-center mb-1">Você está em</p>
              <h2 className="font-display font-bold text-foreground text-lg text-center">{establishment?.name}</h2>
              {table && <p className="text-muted-foreground text-sm text-center mt-0.5">{table.tableLabel}</p>}
            </div>
            <p className="font-display font-semibold text-foreground text-base text-center">Como você quer continuar?</p>
            <div className="flex flex-col gap-3">
              <button onClick={() => authenticate('login')} className="w-full bg-primary text-primary-foreground font-display font-semibold py-4 rounded-xl">Entrar</button>
              <button onClick={() => authenticate('signup-name')} className="w-full border border-border text-foreground font-medium py-3.5 rounded-xl">Criar conta</button>
              <button onClick={() => continueAsVisitor('home-in-bar')} className="w-full text-muted-foreground text-sm py-3 rounded-xl hover:text-foreground">
                Continuar como visitante
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
