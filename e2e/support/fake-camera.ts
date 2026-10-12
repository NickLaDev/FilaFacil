import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './env';

/**
 * Gera um vídeo .y4m de "câmera" mostrando um QR Code, para o Chromium alimentar getUserMedia
 * (--use-fake-device-for-media-stream). O QR é desenhado com a mesma biblioteca `qrcode` que o painel do gestor usa.
 * Limitação: valida o leitor do app, NÃO uma câmera/lente real.
 */
export function makeQrY4m(text: string, file = path.join(ROOT, 'e2e/.results/fake-camera.y4m')): string {
  const QRCode = createRequire(path.join(ROOT, 'apps/web/package.json'))('qrcode');
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n: number = qr.modules.size;
  const W = 640, H = 480, quiet = 4;
  const mod = Math.floor(Math.min(W, H) / (n + quiet * 2));
  const side = (n + quiet * 2) * mod;
  const ox = Math.floor((W - side) / 2), oy = Math.floor((H - side) / 2);
  const Y = Buffer.alloc(W * H, 235);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (qr.modules.get(r, c))
        for (let dy = 0; dy < mod; dy++)
          for (let dx = 0; dx < mod; dx++) Y[(oy + (r + quiet) * mod + dy) * W + ox + (c + quiet) * mod + dx] = 16;
  const U = Buffer.alloc((W / 2) * (H / 2), 128);
  const frames: Buffer[] = [];
  for (let i = 0; i < 15; i++) frames.push(Buffer.from('FRAME\n'), Y, U, U);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), ...frames]));
  return file;
}
