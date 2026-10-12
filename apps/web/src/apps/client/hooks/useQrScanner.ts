import { useEffect, useRef, useState, type RefObject } from 'react';

export type ScannerState = 'starting' | 'scanning' | 'unsupported' | 'denied';

const SCAN_INTERVAL_MS = 250;
/** Largura máxima do quadro analisado pelo decodificador por software (equilíbrio entre precisão e CPU). */
const FRAME_WIDTH = 640;

const hasCamera = () => Boolean(navigator.mediaDevices?.getUserMedia);

/**
 * Leitor de QR Code pela câmera (ficha 02). Usa a Shape Detection API quando o navegador a tem
 * (Chrome/Edge/Android) e, nos demais — Safari no iPhone, Firefox —, decodifica os quadros do vídeo
 * com jsQR. A câmera exige HTTPS (ou localhost); sem ela a tela oferece digitar o código.
 */
export function useQrScanner(videoRef: RefObject<HTMLVideoElement | null>, onCode: (code: string) => void, enabled: boolean) {
  const [state, setState] = useState<ScannerState>(() => (hasCamera() ? 'starting' : 'unsupported'));
  const onCodeRef = useRef(onCode);

  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    if (!enabled || !hasCamera()) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const native = 'BarcodeDetector' in window ? new BarcodeDetector({ formats: ['qr_code'] }) : null;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });

    /** Texto do QR visto no quadro atual, ou null. */
    const readFrame = async (video: HTMLVideoElement): Promise<string | null> => {
      if (native) return (await native.detect(video))[0]?.rawValue || null;
      if (!context || !video.videoWidth) return null;
      const scale = Math.min(1, FRAME_WIDTH / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const { default: jsQR } = await import('jsqr');
      const frame = context.getImageData(0, 0, canvas.width, canvas.height);
      return jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' })?.data || null;
    };

    const scan = async () => {
      const video = videoRef.current;
      if (cancelled || !video) return;
      try {
        const code = await readFrame(video);
        if (code) {
          onCodeRef.current(code);
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
