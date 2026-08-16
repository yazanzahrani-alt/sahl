import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Res,
  UploadedFiles,
  UseInterceptors
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import {
  ApiBody,
  ApiCookieAuth,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags
} from "@nestjs/swagger";
import { Response } from "express";
import { CurrentMemberId } from "../auth/decorators/current-member-id.decorator";
import {
  claimUploadOptions,
  MAX_UPLOAD_FILES,
  UploadedAttachmentFile
} from "./attachment";
import { ClaimsService } from "./claims.service";
import { CreateClaimDto } from "./dto/create-claim.dto";
import { UpdateClaimDto } from "./dto/update-claim.dto";
import { DocumentsService } from "./documents.service";
import { DocumentIntelligenceService } from "../document-intelligence/document-intelligence.service";
import { ClaimValidationService } from "../validation/claim-validation.service";
import type { DocumentAnalysisResult } from "../document-intelligence/document-analysis";
import { ClaimReviewService } from "./claim-review.service";
import { ConfirmValidationIssueDto } from "./dto/confirm-validation-issue.dto";
import { UpdateClaimReviewDto } from "./dto/update-claim-review.dto";
import { ClaimSubmissionService } from "./claim-submission.service";
import { setDocumentResponseHeaders } from "./document-response";
import type { AttachmentRecord } from "./attachment";
import type { ClaimRecord } from "./claim";
import type { ClaimValidationResult } from "../validation/validation";
import { deriveClaimJourney } from "./claim-journey";

@ApiTags("Claims")
@ApiCookieAuth("sahl_session")
@Controller("claims")
export class ClaimsController {
  constructor(
    private readonly claims: ClaimsService,
    private readonly documents: DocumentsService,
    private readonly intelligence: DocumentIntelligenceService,
    private readonly validation: ClaimValidationService,
    private readonly review: ClaimReviewService,
    private readonly submissions: ClaimSubmissionService
  ) {}

  @Post()
  @ApiOperation({ summary: "Create a member-owned claim draft" })
  @ApiCreatedResponse({ description: "Claim draft created" })
  create(
    @CurrentMemberId() memberId: string,
    @Body() input: CreateClaimDto
  ) {
    return this.summary(memberId, this.claims.create(memberId, input));
  }

  @Get()
  @ApiOperation({ summary: "List the authenticated member's claims" })
  @ApiOkResponse({ description: "Member claims returned" })
  findAll(@CurrentMemberId() memberId: string) {
    return this.claims.findAll(memberId).map((claim) =>
      this.summary(memberId, claim)
    );
  }

  @Post(":claimId/attachments")
  @UseInterceptors(
    FilesInterceptor("files", MAX_UPLOAD_FILES, claimUploadOptions)
  )
  @ApiOperation({ summary: "Attach claim documents to a member-owned draft" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: { type: "string", format: "binary" }
        }
      },
      required: ["files"]
    }
  })
  upload(
    @CurrentMemberId() memberId: string,
    @Param("claimId") claimId: string,
    @UploadedFiles() files: UploadedAttachmentFile[] | undefined
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException("Choose at least one document to upload.");
    }

    const added = this.documents.add(memberId, claimId, files);
    const addedIds = new Set(added.map((attachment) => attachment.attachmentId));
    return this.review.enrichAttachments(
      claimId,
      this.documents.list(memberId, claimId)
    ).filter((attachment) => addedIds.has(attachment.attachmentId));
  }

  @Get(":claimId/attachments")
  @ApiOperation({ summary: "List documents attached to a member-owned claim" })
  listAttachments(
    @CurrentMemberId() memberId: string,
    @Param("claimId") claimId: string
  ) {
    return this.review.enrichAttachments(
      claimId,
      this.documents.list(memberId, claimId)
    );
  }

  @Post(":claimId/documents/continue")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Continue from document upload into automated claim checks" })
  async continueFromDocuments(
    @CurrentMemberId() memberId: string,
    @Param("claimId") claimId: string
  ) {
    const claim = this.claims.findOne(memberId, claimId);
    if (claim.status === "accepted_for_processing") {
      return this.detail(memberId, claimId);
    }
    const attachments = this.documents.list(memberId, claimId);
    if (attachments.length === 0) {
      throw new BadRequestException(
        "Upload at least one document before continuing."
      );
    }

    const results = await this.intelligence.analyseAll(memberId, claim);
    const analysisComplete = results.every(
      (result) => result.analysisStatus === "complete"
    );

    if (!analysisComplete) {
      return this.detail(memberId, claimId);
    }

    this.claims.markProcessing(memberId, claimId);
    this.validation.validate(
      memberId,
      claim,
      results,
      new Date(),
      this.review.validationAnalyses(claimId, results)
    );
    return this.detail(memberId, claimId);
  }

  @Put(":claimId/review")
  @ApiOperation({ summary: "Save member-confirmed claim information" })
  saveReview(
    @CurrentMemberId() memberId: string,
    @Param("claimId") claimId: string,
    @Body() input: UpdateClaimReviewDto
  ) {
    const analyses = this.completeAnalyses(memberId, claimId);
    this.review.saveReview(
      memberId,
      claimId,
      analyses,
      input.extracted
    );
    return this.revalidate(memberId, claimId);
  }

  @Post(":claimId/validation/confirm")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Confirm a non-blocking claim review item" })
  confirmIssue(
    @CurrentMemberId() memberId: string,
    @Param("claimId") claimId: string,
    @Body() input: ConfirmValidationIssueDto
  ) {
    this.review.confirmIssue(
      memberId,
      claimId,
      input.code,
      input.attachmentId ?? null,
      input.evidenceUnitId ?? null
    );
    return this.revalidate(memberId, claimId);
  }

  @Post(":claimId/submit")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Submit a reviewed claim for processing" })
  submit(
    @CurrentMemberId() memberId: string,
    @Param("claimId") claimId: string
  ) {
    return this.submissions.submit(memberId, claimId);
  }

  @Get(":claimId/attachments/:attachmentId/download")
  @ApiOperation({ summary: "Open one member-owned claim document" })
  download(
    @CurrentMemberId() memberId: string,
    @Param("claimId") claimId: string,
    @Param("attachmentId") attachmentId: string,
    @Res() response: Response
  ) {
    const { attachment, path } = this.documents.findForDownload(
      memberId,
      claimId,
      attachmentId
    );
    setDocumentResponseHeaders(response, attachment);
    response.sendFile(path);
  }

  @Delete(":claimId/attachments/:attachmentId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove a document from a member-owned claim draft" })
  removeAttachment(
    @CurrentMemberId() memberId: string,
    @Param("claimId") claimId: string,
    @Param("attachmentId") attachmentId: string
  ) {
    this.documents.remove(memberId, claimId, attachmentId);
  }

  @Get(":claimId")
  @ApiOperation({ summary: "Get one member-owned claim" })
  findOne(
    @CurrentMemberId() memberId: string,
    @Param("claimId") claimId: string
  ) {
    return this.detail(memberId, claimId);
  }

  @Patch(":claimId")
  @ApiOperation({ summary: "Update a member-owned claim draft" })
  update(
    @CurrentMemberId() memberId: string,
    @Param("claimId") claimId: string,
    @Body() input: UpdateClaimDto
  ) {
    return this.summary(memberId, this.claims.update(memberId, claimId, input));
  }

  @Delete(":claimId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Permanently discard a member-owned claim draft" })
  discard(
    @CurrentMemberId() memberId: string,
    @Param("claimId") claimId: string
  ) {
    const storedFilenames = this.claims.discard(memberId, claimId);
    this.documents.removeStoredFiles(storedFilenames);
  }

  private revalidate(memberId: string, claimId: string) {
    const claim = this.claims.findOne(memberId, claimId);
    const analyses = this.completeAnalyses(memberId, claimId);
    this.claims.markProcessing(memberId, claimId);
    this.validation.validate(
      memberId,
      claim,
      analyses,
      new Date(),
      this.review.validationAnalyses(claimId, analyses)
    );
    return this.detail(memberId, claimId);
  }

  private detail(memberId: string, claimId: string) {
    const claim = this.claims.findOne(memberId, claimId);
    const currentValidation = this.validation.getCurrent(claim);
    const attachments = this.review.enrichAttachments(
      claimId,
      this.documents.list(memberId, claimId)
    );
    return {
      ...claim,
      journey: this.journey(claim, attachments, currentValidation),
      attachments,
      review: this.review.buildReview(
        claimId,
        attachments
          .map((attachment) => attachment.analysis)
          .filter((analysis): analysis is DocumentAnalysisResult => analysis !== null),
        currentValidation?.issues ?? [],
        claim.category
      ),
      submission: this.submissions.findForMember(memberId, claimId),
      validation: currentValidation
    };
  }

  private summary(memberId: string, claim: ClaimRecord) {
    const attachments = this.review.enrichAttachments(
      claim.claimId,
      this.documents.list(memberId, claim.claimId)
    );
    const validation = this.validation.getCurrent(claim);
    return {
      ...claim,
      journey: this.journey(claim, attachments, validation)
    };
  }

  private journey(
    claim: ClaimRecord,
    attachments: AttachmentRecord[],
    validation: ClaimValidationResult | null
  ) {
    return deriveClaimJourney(
      claim,
      attachments,
      validation,
      (attachment) => this.intelligence.isAnalysisCurrent(attachment.analysis)
    );
  }

  private completeAnalyses(memberId: string, claimId: string) {
    const attachments = this.documents.list(memberId, claimId);
    const analyses = attachments
      .map((attachment) => attachment.analysis)
      .filter(
        (analysis): analysis is DocumentAnalysisResult =>
          analysis?.analysisStatus === "complete"
      );
    if (analyses.length !== attachments.length) {
      throw new BadRequestException(
        "Finish document analysis before reviewing extracted values."
      );
    }
    return analyses;
  }
}
