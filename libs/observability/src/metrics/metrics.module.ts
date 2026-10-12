import { Controller, Get, Header, Module, type OnModuleInit } from '@nestjs/common';
import { collectProcessMetrics, metricsRegistry } from './metrics';

/** Internal services only: the gateway does not mount it, so nothing leaks publicly. */
@Controller('metrics')
class MetricsController {
  @Get()
  @Header('content-type', metricsRegistry.contentType)
  metrics(): Promise<string> {
    return metricsRegistry.metrics();
  }
}

@Module({ controllers: [MetricsController] })
export class MetricsModule implements OnModuleInit {
  onModuleInit(): void {
    collectProcessMetrics();
  }
}
