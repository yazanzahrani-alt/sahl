import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import type { DocumentsService } from "../claims/documents.service";
import { OpsAccessService } from "./ops-access.service";
import { OpsController } from "./ops.controller";
import type { OpsService } from "./ops.service";

describe("Demo Ops access", () => {
  const acceptedClaims = [{ claimId: "CLM-OTHER" }];
  let ops: { listAccepted: jest.Mock };
  let documents: { findAcceptedForOpsDownload: jest.Mock };
  let controller: OpsController;

  beforeEach(() => {
    ops = { listAccepted: jest.fn(() => acceptedClaims) };
    documents = { findAcceptedForOpsDownload: jest.fn() };
    const access = new OpsAccessService(new ConfigService({
      NODE_ENV: "development",
      DEMO_OPS_ENABLED: "true"
    }));
    controller = new OpsController(
      ops as unknown as OpsService,
      access,
      documents as unknown as DocumentsService
    );
  });

  it("enables the demo view for every authenticated member", () => {
    expect(controller.status("87654321")).toEqual({ enabled: true });
    expect(controller.listAccepted("87654321")).toEqual(acceptedClaims);
    expect(ops.listAccepted).toHaveBeenCalledWith("87654321");
  });

  it("passes member ownership into document downloads", () => {
    documents.findAcceptedForOpsDownload.mockReturnValue({
      attachment: {
        originalFilename: "invoice.pdf",
        mimeType: "application/pdf"
      },
      path: "C:\\safe\\invoice.pdf"
    });
    const response = {
      set: jest.fn(),
      type: jest.fn(),
      sendFile: jest.fn()
    } as unknown as Response;

    controller.download(
      "87654321",
      "CLM-OTHER",
      "ATT-OTHER",
      response
    );

    expect(documents.findAcceptedForOpsDownload).toHaveBeenCalledWith(
      "87654321",
      "CLM-OTHER",
      "ATT-OTHER"
    );
  });

  it("preserves the existing demo member path", () => {
    expect(controller.status("00123456")).toEqual({ enabled: true });
    expect(controller.listAccepted("00123456")).toEqual(acceptedClaims);
    expect(ops.listAccepted).toHaveBeenCalledWith("00123456");
  });
});
