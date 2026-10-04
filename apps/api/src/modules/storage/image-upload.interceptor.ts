import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { badRequest } from '../../common/http/app-error.js';
import { ACCEPTED_IMAGE_MIME_TYPES } from './image-upload.service.js';

/** Upload multipart de uma imagem no campo `file`, em memória e com teto de tamanho/partes. */
export const ImageFileInterceptor = (maxBytes: number) =>
  FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 5, parts: 6 },
    fileFilter: (_request, file, callback) => {
      if (ACCEPTED_IMAGE_MIME_TYPES.includes(file.mimetype)) callback(null, true);
      else callback(badRequest('UNSUPPORTED_IMAGE', 'Use uma imagem PNG, JPG ou WEBP.'), false);
    },
  });
