import { Module } from "@nestjs/common";
import { ClaimsModule } from "../claims/claims.module";
import { DatabaseModule } from "../database/database.module";
import { OpsAccessService } from "./ops-access.service";
import { OpsController } from "./ops.controller";
import { OpsService } from "./ops.service";

@Module({
  imports: [DatabaseModule, ClaimsModule],
  controllers: [OpsController],
  providers: [OpsAccessService, OpsService]
})
export class OpsModule {}
