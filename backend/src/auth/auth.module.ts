import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { MembersModule } from "../members/members.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { getOrCreateJwtSecret } from "./jwt-secret";
import { SESSION_CONFIG } from "./session.config";

@Module({
  imports: [
    MembersModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: getOrCreateJwtSecret(
          config.get<string>("SQLITE_PATH", "./data/sahl.db")
        ),
        signOptions: {
          expiresIn: SESSION_CONFIG.durationSeconds,
          issuer: SESSION_CONFIG.issuer,
          audience: SESSION_CONFIG.audience
        }
      })
    })
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [JwtModule]
})
export class AuthModule {}
