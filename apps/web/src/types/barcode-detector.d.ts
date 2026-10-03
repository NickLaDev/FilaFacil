// Shape Detection API (Chrome/Android/Edge) — ainda fora do lib.dom do TypeScript.
interface DetectedBarcode {
  rawValue: string;
}

declare class BarcodeDetector {
  constructor(options?: { formats: string[] });
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
