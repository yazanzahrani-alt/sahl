import { forwardRef, Module } from "@nestjs/common";
import { ClaimsModule } from "../claims/claims.module";
import { DatabaseModule } from "../database/database.module";
import { ClaimValidationService } from "./claim-validation.service";

@Module({
  imports: [DatabaseModule, forwardRef(() => ClaimsModule)],
  providers: [ClaimValidationService],
  exports: [ClaimValidationService]
})
export class ValidationModule {}
