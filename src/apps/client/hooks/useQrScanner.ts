import { useEffect, useRef, useState, type RefObject } from 'react';

export type ScannerState = 'starting' | 'scanning' | 'unsupported' | 'denied';

const SCAN_INTERVAL_MS = 300;

const isScannerSupported = () => 'BarcodeDetector' in window && Boolean(navigator.mediaDevices?.getUserMedia);

/**
 * Leitor de QR Code pela câmera (ficha 02) usando a Shape Detection API nativa.
 * Onde o navegador não suporta (ex.: Safari), a tela oferece a digitação do código.
 */
export function useQrScanner(videoRef: RefObject<HTMLVideoElement | null>, onCode: (code: string) => void, enabled: boolean) {
  const [state, setState] = useState<ScannerState>(() => (isScannerSupported() ? 'starting' : 'unsupported'));
  const onCodeRef = useRef(onCode);

  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    if (!enabled || !isScannerSupported()) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const detector = new BarcodeDetector({ formats: ['qr_code'] });

    const scan = async () => {
      const video = videoRef.current;
      if (cancelled || !video) return;
      try {
        const [barcode] = await detector.detect(video);
        if (barcode?.rawValue) {
          onCodeRef.current(barcode.rawValue);
          return;
        }
      } catch {
        // Quadro ainda sem imagem: tenta de novo no próximo ciclo.
      }
      timer = setTimeout(scan, SCAN_INTERVAL_MS);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async mediaStream => {
        if (cancelled) return mediaStream.getTracks().forEach(track => track.stop());
        stream = mediaStream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = mediaStream;
        await video.play();
        setState('scanning');
        void scan();
      })
      .catch(() => !cancelled && setState('denied'));

    return () => {
      cancelled = true;
      clearTimeout(timer);
      stream?.getTracks().forEach(track => track.stop());
    };
  }, [enabled, videoRef]);

  return state;
}
