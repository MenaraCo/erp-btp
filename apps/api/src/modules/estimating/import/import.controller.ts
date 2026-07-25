import {
  BadRequestException,
  Controller,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequiresCapability } from '../../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../../core/rbac/requires-permission.decorator';
import { DpgfFormat, ImportService } from './import.service';

/** Fichier téléversé (sous-ensemble de Express.Multer.File — évite la dépendance de types multer). */
interface UploadedMulterFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

@Controller('imports')
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  /** Importe un DPGF (bordereau) → nouvelle affaire + devis. `format` = xml | excel (auto par extension). */
  @Post('devis')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  importDevis(
    @UploadedFile() file: UploadedMulterFile,
    @Query('format') format?: string,
  ) {
    if (!file?.buffer) throw new BadRequestException('Fichier manquant.');
    const resolved: DpgfFormat = (format as DpgfFormat) || this.detectFormat(file.originalname);
    return this.imports.importDevis(file.buffer, resolved);
  }

  private detectFormat(filename: string): DpgfFormat {
    const ext = (filename || '').toLowerCase().split('.').pop();
    if (ext === 'xml') return 'xml';
    if (ext === 'xlsx' || ext === 'xls') return 'excel';
    throw new BadRequestException('Format non reconnu : fournissez un .xml, .xlsx ou .xls.');
  }
}
