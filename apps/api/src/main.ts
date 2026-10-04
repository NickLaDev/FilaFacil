import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { AppConfig } from './config/app-config.js';
import { loadRootEnvFile } from './config/load-env-file.js';
import { setupApp, setupSwagger } from './setup-app.js';

async function bootstrap() {
  loadRootEnvFile();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const config = app.get(AppConfig);
  setupApp(app, config);
  if (!config.isProduction) setupSwagger(app);
  await app.listen(config.env.API_PORT);
  Logger.log(`API em http://localhost:${config.env.API_PORT}/api · docs em /api/docs`, 'Bootstrap');
}

await bootstrap();
