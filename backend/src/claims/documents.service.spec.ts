import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseService } from "../database/database.service";
import {
  MAX_UPLOAD_FILE_SIZE_BYTES,
  UploadedAttachmentFile,
  claimUploadOptions
} from "./attachment";
import { ClaimsService } from "./claims.service";
import { DocumentsService } from "./documents.service";

describe("DocumentsService upload hardening", () => {
  let directory: string;
  let database: DatabaseService;
  let claims: ClaimsService;
  let documents: DocumentsService;
  let claimId: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "sahl-upload-"));
    process.env.UPLOADS_PATH = join(directory, "uploads");
    database = new DatabaseService(new ConfigService({
      SQLITE_PATH: join(directory, "sahl.db")
    }));
    database.onModuleInit();
    database.run(
      `INSERT INTO members (member_id, member_id_source, password_hash, created_at)
       VALUES (?, 'provided', ?, ?)`,
      "00123456",
      "test-hash",
      new Date().toISOString()
    );
    claims = new ClaimsService(database);
    documents = new DocumentsService(database, claims);
    claimId = claims.create("00123456", {
      category: "dental",
      claimLocation: "local"
    }).claimId;
  });

  afterEach(() => {
    database.onApplicationShutdown();
    rmSync(directory, { recursive: true, force: true });
    delete process.env.UPLOADS_PATH;
  });

  function uploaded(
    filename: string,
    originalname: string,
    mimetype: string,
    bytes: Buffer
  ): UploadedAttachmentFile {
    const path = join(process.env.UPLOADS_PATH!, filename);
    mkdirSync(process.env.UPLOADS_PATH!, { recursive: true });
    writeFileSync(path, bytes);
    return { filename, originalname, mimetype, size: bytes.length };
  }

  it.each([
    ["JPEG", "photo.jpg", "image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1])],
    ["PNG", "scan.png", "image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["PDF", "invoice.pdf", "application/pdf", Buffer.from("%PDF-1.7")]
  ])("accepts a valid %s signature", (_kind, originalname, mimetype, bytes) => {
    const file = uploaded(`stored-${originalname}`, originalname, mimetype, bytes);

    const result = documents.add("00123456", claimId, [file]);

    expect(result).toHaveLength(1);
    expect(result[0].mimeType).toBe(mimetype);
  });

  it("rejects and removes a spoofed upload", () => {
    const file = uploaded(
      "spoofed.pdf",
      "invoice.pdf",
      "application/pdf",
      Buffer.from("not a pdf")
    );

    expect(() => documents.add("00123456", claimId, [file])).toThrow(
      BadRequestException
    );
    expect(existsSync(join(process.env.UPLOADS_PATH!, file.filename))).toBe(false);
  });

  it("keeps oversized files rejected by the upload interceptor", () => {
    expect(claimUploadOptions.limits?.fileSize).toBe(
      MAX_UPLOAD_FILE_SIZE_BYTES
    );
  });

  it("also rejects an oversized file at the storage boundary", () => {
    const bytes = Buffer.alloc(MAX_UPLOAD_FILE_SIZE_BYTES + 1);
    bytes.write("%PDF-");
    const file = uploaded(
      "oversized.pdf",
      "oversized.pdf",
      "application/pdf",
      bytes
    );

    expect(() => documents.add("00123456", claimId, [file])).toThrow(
      "Each document must be 10 MB or smaller."
    );
  });

  it("enforces the 10-document cap across repeated batches", () => {
    const firstBatch = Array.from({ length: 10 }, (_, index) => uploaded(
      `stored-${index}.pdf`,
      `invoice-${index}.pdf`,
      "application/pdf",
      Buffer.from(`%PDF-${index}`)
    ));
    documents.add("00123456", claimId, firstBatch);
    const extra = uploaded(
      "stored-extra.pdf",
      "extra.pdf",
      "application/pdf",
      Buffer.from("%PDF-extra")
    );

    expect(() => documents.add("00123456", claimId, [extra])).toThrow(
      "You can attach up to 10 documents to one claim. Remove a document before adding another."
    );
  });

  it("invalidates review state when a targeted source document is removed", () => {
    const [primary, secondary] = documents.add("00123456", claimId, [
      uploaded("primary.pdf", "primary.pdf", "application/pdf", Buffer.from("%PDF-primary")),
      uploaded("secondary.pdf", "secondary.pdf", "application/pdf", Buffer.from("%PDF-secondary"))
    ]);
    const primaryRaw = '{"source":"primary"}';
    database.run(
      "INSERT INTO extraction_results (attachment_id, result_json, created_at) VALUES (?, ?, ?)",
      primary.attachmentId,
      primaryRaw,
      new Date().toISOString()
    );
    database.run(
      "INSERT INTO extraction_results (attachment_id, result_json, created_at) VALUES (?, ?, ?)",
      secondary.attachmentId,
      '{"source":"secondary"}',
      new Date().toISOString()
    );
    database.run("UPDATE claims SET status = 'ready' WHERE claim_id = ?", claimId);

    documents.remove("00123456", claimId, secondary.attachmentId);

    expect(claims.findOne("00123456", claimId).status).toBe("draft");
    expect(documents.list("00123456", claimId).map((item) => item.attachmentId))
      .toEqual([primary.attachmentId]);
    expect(database.get<{ result_json: string }>(
      "SELECT result_json FROM extraction_results WHERE attachment_id = ?",
      primary.attachmentId
    )?.result_json).toBe(primaryRaw);
  });

  it("marks validation stale when a document is added without discarding reusable extraction", () => {
    const [existing] = documents.add("00123456", claimId, [uploaded(
      "existing.pdf",
      "existing.pdf",
      "application/pdf",
      Buffer.from("%PDF-existing")
    )]);
    const existingRaw = '{"analysisStatus":"complete","source":"existing"}';
    database.run(
      "INSERT INTO extraction_results (attachment_id, result_json, created_at) VALUES (?, ?, ?)",
      existing.attachmentId,
      existingRaw,
      new Date().toISOString()
    );
    database.run("UPDATE claims SET status = 'ready' WHERE claim_id = ?", claimId);

    documents.add("00123456", claimId, [uploaded(
      "new.pdf",
      "new.pdf",
      "application/pdf",
      Buffer.from("%PDF-new")
    )]);

    expect(claims.findOne("00123456", claimId).status).toBe("draft");
    expect(database.get<{ result_json: string }>(
      "SELECT result_json FROM extraction_results WHERE attachment_id = ?",
      existing.attachmentId
    )?.result_json).toBe(existingRaw);
  });

  it("keeps Demo Ops downloads scoped to the authenticated member", () => {
    database.run(
      `INSERT INTO members (member_id, member_id_source, password_hash, created_at)
       VALUES (?, 'provided', ?, ?)`,
      "87654321",
      "test-hash",
      new Date().toISOString()
    );
    const otherClaimId = claims.create("87654321", {
      category: "dental",
      claimLocation: "local"
    }).claimId;
    const [attachment] = documents.add("87654321", otherClaimId, [uploaded(
      "other-member.pdf",
      "other-member.pdf",
      "application/pdf",
      Buffer.from("%PDF-other-member")
    )]);
    database.run(
      "UPDATE claims SET status = 'accepted_for_processing' WHERE claim_id = ?",
      otherClaimId
    );
    database.run(
      `INSERT INTO claim_submissions
       (claim_id, acceptance_reference, payload_json, submitted_at)
       VALUES (?, ?, '{}', ?)`,
      otherClaimId,
      "ACC-OTHER",
      new Date().toISOString()
    );

    expect(() => documents.findAcceptedForOpsDownload(
      "00123456",
      otherClaimId,
      attachment.attachmentId
    )).toThrow(NotFoundException);
    expect(documents.findAcceptedForOpsDownload(
      "87654321",
      otherClaimId,
      attachment.attachmentId
    ).attachment.attachmentId).toBe(attachment.attachmentId);
  });
});
