import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { API_KEY_HEADER } from '@pdp/contracts';
import { type Env } from './config';

export function configureApp(app: NestExpressApplication): void {
  // Rate limits for unknown keys are per client IP; behind nginx that IP comes from X-Forwarded-For.
  app.set(
    'trust proxy',
    app.get<ConfigService<Env, true>>(ConfigService).get('TRUST_PROXY_HOPS', { infer: true }),
  );
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('PDP Media Pipeline')
      .setVersion('1')
      .addApiKey({ type: 'apiKey', in: 'header', name: API_KEY_HEADER }, API_KEY_HEADER)
      .addSecurityRequirements(API_KEY_HEADER)
      .build(),
  );
  SwaggerModule.setup('docs', app, document);
}
