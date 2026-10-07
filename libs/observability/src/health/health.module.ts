import {
  type DynamicModule,
  type InjectionToken,
  Module,
  type ModuleMetadata,
} from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { READINESS_CHECKS, type ReadinessCheck } from './readiness-check';

export interface HealthModuleOptions {
  imports?: ModuleMetadata['imports'];
  inject?: InjectionToken[];
  useFactory: (...deps: never[]) => ReadinessCheck[];
}

@Module({})
export class HealthModule {
  static forRootAsync(options: HealthModuleOptions): DynamicModule {
    return {
      module: HealthModule,
      imports: [TerminusModule.forRoot({ logger: false }), ...(options.imports ?? [])],
      controllers: [HealthController],
      providers: [
        {
          provide: READINESS_CHECKS,
          inject: options.inject ?? [],
          useFactory: options.useFactory,
        },
      ],
    };
  }
}
