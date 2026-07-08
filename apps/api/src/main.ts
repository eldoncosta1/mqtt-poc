import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { createMqttMicroserviceOptions } from './shared/mqtt/mqtt-microservice-options'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  app.connectMicroservice(createMqttMicroserviceOptions())

  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))

  const config = new DocumentBuilder().setTitle('MQTT Device Commands API').setVersion('1.0').build()
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config))

  // Sobe o HTTP primeiro — a API REST/WebSocket não deve ficar refém do broker.
  await app.listen(process.env.PORT ?? 3333)
  console.log(`API rodando em http://localhost:${process.env.PORT ?? 3333}`)
  console.log(`Swagger em http://localhost:${process.env.PORT ?? 3333}/docs`)

  // MQTT conecta em background com retry — se o broker estiver fora, o HTTP segue no ar.
  app.startAllMicroservices().catch((err) =>
    console.error('[mqtt] microservice não conectou (segue tentando):', err?.message ?? err),
  )
}

bootstrap()
