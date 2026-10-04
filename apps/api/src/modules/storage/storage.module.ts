import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.js';
import { FileStorage } from './file-storage.js';
import { ImageUploadService } from './image-upload.service.js';
import { LocalFileStorage } from './local-file-storage.js';

@Global()
@Module({
  providers: [
    { provide: FileStorage, inject: [AppConfig], useFactory: (config: AppConfig) => new LocalFileStorage(config.env.STORAGE_LOCAL_DIR) },
    ImageUploadService,
  ],
  exports: [FileStorage, ImageUploadService],
})
export class StorageModule {}
