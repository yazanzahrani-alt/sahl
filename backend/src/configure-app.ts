import { type INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { SESSION_CONFIG } from "./auth/session.config";
import { parseAllowedOrigins } from "./environment";

export function configureApp(app: INestApplication) {
  const config = app.get(ConfigService);

  app.setGlobalPrefix("api");
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    })
  );
  const allowedOrigins = parseAllowedOrigins(
    config.getOrThrow<string>("WEB_ORIGIN")
  );
  app.enableCors({
    origin: allowedOrigins,
    credentials: true
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Sahl API")
    .setDescription("Bupa reimbursement-document prototype API")
    .setVersion("0.1.0")
    .addCookieAuth(SESSION_CONFIG.cookieName)
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/docs", app, document);
}
