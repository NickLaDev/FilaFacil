import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { AppConfig } from '../../config/app-config.js';
import { badRequest } from '../../common/http/app-error.js';
import { FileStorage } from './file-storage.js';

const MAX_DIMENSION = 1600;
const MAX_INPUT_PIXELS = 40_000_000;

/** Assinaturas (magic bytes) dos formatos aceitos: a extensão e o MIME enviados não são confiáveis. */
function detectImageType(buffer: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export interface UploadedImage {
  buffer: Buffer;
  size: number;
}

export const ACCEPTED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Valida e normaliza imagens enviadas: confere o conteúdo real, decodifica e reencoda em WebP
 * (remove metadados como GPS/EXIF e neutraliza arquivos poliglotas), limita dimensões e grava no storage.
 */
@Injectable()
export class ImageUploadService {
  constructor(
    private readonly storage: FileStorage,
    private readonly config: AppConfig,
  ) {}

  async store(file: UploadedImage | undefined) {
    if (!file) throw badRequest('FILE_REQUIRED', 'Envie uma imagem no campo "file".');
    if (file.size > this.config.env.UPLOAD_MAX_BYTES) throw badRequest('FILE_TOO_LARGE', 'A imagem excede o tamanho máximo permitido.');
    if (!detectImageType(file.buffer)) throw badRequest('UNSUPPORTED_IMAGE', 'Use uma imagem PNG, JPG ou WEBP.');

    let output: Buffer;
    try {
      output = await sharp(file.buffer, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw badRequest('UNSUPPORTED_IMAGE', 'Não foi possível ler a imagem enviada.');
    }
    return this.storage.save(output, 'webp', 'image/webp');
  }

  /** Remove o arquivo antigo depois de uma troca/exclusão (falha aqui não desfaz a operação principal). */
  async discard(key: string | null | undefined) {
    if (key) await this.storage.delete(key).catch(() => undefined);
  }
}
