import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { MailerService } from './mailer.service';

/** Envoi d'e-mails — partagé par les modules qui expédient des documents. */
@Module({
  imports: [TenancyModule],
  providers: [MailerService],
  exports: [MailerService],
})
export class MailerModule {}
