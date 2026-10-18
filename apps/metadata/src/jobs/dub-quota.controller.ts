import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { type DubQuotaDto } from '@pdp/contracts';
import { JobsService } from './jobs.service';

/** Internal API: reachable only inside the compose network / cluster, no auth. */
@Controller('internal/users')
export class DubQuotaController {
  constructor(private readonly jobs: JobsService) {}

  @Get(':id/dub-quota')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<DubQuotaDto> {
    return this.jobs.dubQuota(id);
  }
}
