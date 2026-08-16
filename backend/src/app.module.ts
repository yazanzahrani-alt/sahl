import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { AuthModule } from "./auth/auth.module";
import { JwtAuthGuard } from "./auth/guards/jwt-auth.guard";
import { ClaimsModule } from "./claims/claims.module";
import { DocumentIntelligenceModule } from "./document-intelligence/document-intelligence.module";
import { validateEnvironment } from "./environment";
import { MembersModule } from "./members/members.module";
import { ValidationModule } from "./validation/validation.module";
import { OpsModule } from "./ops/ops.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment
    }),
    MembersModule,
    AuthModule,
    ClaimsModule,
    DocumentIntelligenceModule,
    ValidationModule,
    OpsModule
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard
    }
  ]
})
export class AppModule {}
