import { join } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.js';
import { FileStorage } from './file-storage.js';
import { ImageUploadService } from './image-upload.service.js';
import { LocalFileStorage } from './local-file-storage.js';
import { PrivateDocumentStorage } from './private-document-storage.js';

@Global()
@Module({
  providers: [
    { provide: FileStorage, inject: [AppConfig], useFactory: (config: AppConfig) => new LocalFileStorage(config.env.STORAGE_LOCAL_DIR) },
    ImageUploadService,
    // Irmã da pasta pública (ex.: storage/private), nunca servida como arquivo estático.
    { provide: PrivateDocumentStorage, inject: [AppConfig], useFactory: (config: AppConfig) => new PrivateDocumentStorage(join(config.env.STORAGE_LOCAL_DIR, '..', 'private')) },
  ],
  exports: [FileStorage, ImageUploadService, PrivateDocumentStorage],
})
export class StorageModule {}
