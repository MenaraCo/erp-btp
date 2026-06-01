import { ForbiddenException } from '@nestjs/common';

/** Raised when a creation action would exceed a tenant quota (checked before creation). */
export class QuotaExceededException extends ForbiddenException {
  constructor(metricKey: string, limit: number, current: number) {
    super({
      message: `Quota exceeded for "${metricKey}" (limit ${limit}, current ${current})`,
      error: 'QuotaExceeded',
      metricKey,
      limit,
      current,
    });
  }
}
