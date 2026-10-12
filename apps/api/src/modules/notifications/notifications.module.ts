import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.js';
import { createEmailSender, createSmsSender, EmailSender, SmsSender } from './message-senders.js';

@Global()
@Module({
  providers: [
    { provide: SmsSender, inject: [AppConfig], useFactory: (config: AppConfig) => createSmsSender(config.env.SMS_PROVIDER) },
    { provide: EmailSender, inject: [AppConfig], useFactory: (config: AppConfig) => createEmailSender(config.env) },
  ],
  exports: [SmsSender, EmailSender],
})
export class NotificationsModule {}
