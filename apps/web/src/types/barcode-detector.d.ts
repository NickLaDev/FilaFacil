// Shape Detection API (Chrome/Android/Edge) — ainda fora do lib.dom do TypeScript. Safari/iOS e Firefox
// não a têm: o leitor cai para jsQR (ver useQrScanner).
interface DetectedBarcode {
  rawValue: string;
}

declare class BarcodeDetector {
  constructor(options?: { formats: string[] });
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
