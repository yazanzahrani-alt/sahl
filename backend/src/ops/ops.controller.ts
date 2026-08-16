import { Controller, Get, Param, Res } from "@nestjs/common";
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CurrentMemberId } from "../auth/decorators/current-member-id.decorator";
import { setDocumentResponseHeaders } from "../claims/document-response";
import { DocumentsService } from "../claims/documents.service";
import { OpsAccessService } from "./ops-access.service";
import { OpsService } from "./ops.service";

@ApiTags("Demo Ops")
@ApiCookieAuth("sahl_session")
@Controller("ops")
export class OpsController {
  constructor(
    private readonly ops: OpsService,
    private readonly access: OpsAccessService,
    private readonly documents: DocumentsService
  ) {}

  @Get("status")
  @ApiOperation({ summary: "Check whether the synthetic Demo Ops view is enabled" })
  @ApiOkResponse({ description: "Demo Ops availability returned" })
  status(@CurrentMemberId() memberId: string) {
    return { enabled: this.access.isEnabledFor(memberId) };
  }

  @Get("claims")
  @ApiOperation({ summary: "List claims accepted for synthetic downstream processing" })
  @ApiOkResponse({ description: "Accepted synthetic claims returned" })
  listAccepted(@CurrentMemberId() memberId: string) {
    this.access.assertAuthorized(memberId);
    return this.ops.listAccepted(memberId);
  }

  @Get("claims/:claimId/attachments/:attachmentId/download")
  @ApiOperation({ summary: "Open a source document for an accepted synthetic claim" })
  download(
    @CurrentMemberId() memberId: string,
    @Param("claimId") claimId: string,
    @Param("attachmentId") attachmentId: string,
    @Res() response: Response
  ) {
    this.access.assertAuthorized(memberId);
    const { attachment, path } = this.documents.findAcceptedForOpsDownload(
      memberId,
      claimId,
      attachmentId
    );
    setDocumentResponseHeaders(response, attachment);
    response.sendFile(path);
  }
}
