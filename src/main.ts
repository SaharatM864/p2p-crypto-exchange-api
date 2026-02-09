import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 1. Security Headers (Best Practice)
  app.use(helmet());

  // 2. Enable CORS
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true,
  });

  // 3. Global Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // 4. API Versioning
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // 5. API Documentation (Swagger)
  const config = new DocumentBuilder()
    .setTitle('P2P Crypto Exchange API')
    .setDescription('The P2P Crypto Exchange API documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger documentation: http://localhost:${port}/api/docs`);
}
void bootstrap();
