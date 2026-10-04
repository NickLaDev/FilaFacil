import { useState } from 'react';
import { Loader2, MapPin, Navigation } from 'lucide-react';
import { findRegions, requestDeviceLocation, setManualLocation, type KNOWN_REGIONS } from '@/services/deviceService';
import { useClient } from '../clientContext';
import { BackButton } from '../components/Layout';

/** Geolocalização do usuário ou região manual para a busca por proximidade (ficha 11). */
export default function LocationScreen() {
  const { go, showToast } = useClient();
  const [manual, setManual] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [notice, setNotice] = useState('');

  async function useDeviceLocation() {
    setRequesting(true);
    const result = await requestDeviceLocation();
    setRequesting(false);
    if (result === 'granted') {
      showToast('Localização atualizada');
      go('explore');
      return;
    }
    setNotice(result === 'denied' ? 'Não conseguimos acessar sua localização. Escolha a região manualmente.' : 'Seu navegador não oferece localização.');
    setManual(true);
  }

  // Sem serviço de geocodificação, a região manual é escolhida entre as cadastradas (com coordenadas).
  const suggestions = findRegions(manualInput);

  function confirmManual(region: (typeof KNOWN_REGIONS)[number] | undefined) {
    if (!region) return setNotice('Escolha uma das regiões da lista.');
    setManualLocation(region);
    showToast('Região atualizada');
    go('explore');
  }

  if (manual) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="px-5 pt-5">
          <BackButton onClick={() => setManual(false)} />
        </div>
        <div className="flex-1 flex flex-col px-6 py-6 gap-5">
          <div>
            <h1 className="font-display font-bold text-foreground text-2xl">Qual é a sua região?</h1>
            <p className="text-muted-foreground text-sm mt-1">Digite seu bairro ou cidade e escolha na lista</p>
          </div>
          {notice && <p className="text-sm text-warning bg-warning-bg rounded-xl px-4 py-3">{notice}</p>}
          <input
            value={manualInput}
            onChange={event => setManualInput(event.target.value.slice(0, 80))}
            placeholder="Ex: Barão Geraldo, Campinas"
            aria-label="Região"
            className="w-full bg-card border border-border rounded-xl px-4 py-3.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            autoFocus
          />
          {suggestions.map(region => (
            <button key={region.label} onClick={() => confirmManual(region)} className="flex items-center gap-3 text-left px-1 py-1">
              <MapPin size={15} className="text-muted-foreground flex-shrink-0" />
              <span className="text-sm text-foreground">{region.label}</span>
            </button>
          ))}
          {suggestions.length === 0 && <p className="text-sm text-muted-foreground px-1">Nenhuma região encontrada com esse nome.</p>}
          <div className="mt-auto">
            <button
              onClick={() => confirmManual(suggestions[0])}
              disabled={suggestions.length === 0}
              className="w-full bg-primary text-primary-foreground font-display font-semibold py-4 rounded-xl disabled:opacity-50"
            >
              Confirmar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="px-5 pt-5">
        <BackButton onClick={() => go('home-out-of-bar')} />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-8 gap-7 pb-24">
        <div className="w-24 h-24 rounded-3xl bg-primary/10 flex items-center justify-center">
          <MapPin size={44} className="text-primary" />
        </div>
        <div className="text-center">
          <h1 className="font-display font-bold text-foreground text-2xl">Encontre lugares perto de você</h1>
          <p className="text-muted-foreground text-sm mt-2 leading-relaxed">
            Use sua localização para encontrar bares e restaurantes que aceitam pedidos pelo app.
          </p>
        </div>
        <div className="w-full flex flex-col gap-3">
          <button
            onClick={useDeviceLocation}
            disabled={requesting}
            className="w-full bg-primary text-primary-foreground font-display font-semibold py-4 rounded-xl flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {requesting ? <Loader2 size={17} className="animate-spin" /> : <Navigation size={17} />}
            Usar minha localização
          </button>
          <button onClick={() => setManual(true)} className="w-full border border-border text-foreground font-medium py-3.5 rounded-xl text-sm">
            Escolher localização manualmente
          </button>
        </div>
      </div>
    </div>
  );
}
