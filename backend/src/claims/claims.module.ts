import { forwardRef, Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { DocumentIntelligenceModule } from "../document-intelligence/document-intelligence.module";
import { ClaimsController } from "./claims.controller";
import { ClaimsService } from "./claims.service";
import { DocumentsService } from "./documents.service";
import { ValidationModule } from "../validation/validation.module";
import { ClaimReviewService } from "./claim-review.service";
import { ClaimSubmissionService } from "./claim-submission.service";

@Module({
  imports: [
    DatabaseModule,
    forwardRef(() => DocumentIntelligenceModule),
    forwardRef(() => ValidationModule)
  ],
  controllers: [ClaimsController],
  providers: [
    ClaimsService,
    DocumentsService,
    ClaimReviewService,
    ClaimSubmissionService
  ],
  exports: [
    ClaimsService,
    DocumentsService,
    ClaimReviewService,
    ClaimSubmissionService
  ]
})
export class ClaimsModule {}
