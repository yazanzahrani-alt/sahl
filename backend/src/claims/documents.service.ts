import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { DatabaseService } from "../database/database.service";
import {
  AttachmentRecord,
  createAttachmentId,
  getUploadDirectory,
  MAX_CLAIM_ATTACHMENTS,
  MAX_UPLOAD_FILE_SIZE_BYTES,
  StoredAttachment,
  UploadedAttachmentFile
} from "./attachment";
import { ClaimsService } from "./claims.service";
import type { DocumentAnalysisResult } from "../document-intelligence/document-analysis";

interface AttachmentRow {
  attachment_id: string;
  original_filename: string;
  stored_filename: string;
  mime_type: string;
  size_bytes: number;
  document_type: string | null;
  created_at: string;
  analysis_json: string | null;
}

function mapAttachment(row: AttachmentRow): StoredAttachment {
  return {
    attachmentId: row.attachment_id,
    originalFilename: row.original_filename,
    storedFilename: row.stored_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    documentType: row.document_type,
    createdAt: new Date(row.created_at),
    analysis: parseAnalysis(row.analysis_json)
  };
}

function parseAnalysis(value: string | null): DocumentAnalysisResult | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as DocumentAnalysisResult;
  } catch {
    return null;
  }
}

function toAttachmentRecord(attachment: StoredAttachment): AttachmentRecord {
  const { storedFilename: _storedFilename, ...record } = attachment;
  return record;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly claims: ClaimsService
  ) {}

  add(memberId: string, claimId: string, files: UploadedAttachmentFile[]) {
    if (files.length === 0) {
      throw new BadRequestException("Choose at least one document to upload.");
    }

    const createdAt = new Date().toISOString();

    try {
      this.claims.findOne(memberId, claimId);
      this.assertFileSizes(files);
      this.assertFileSignatures(files);
      const filesWithHashes = files.map((file) => ({
        file,
        sha256: this.fileHash(file.filename)
      }));
      this.assertUniqueUploadBatch(filesWithHashes.map(({ sha256 }) => sha256));
      const attachments = this.database.transaction(() => {
        this.assertClaimAttachmentLimit(claimId, files.length);
        const records = filesWithHashes.map(({ file, sha256 }) => {
          this.assertNotAlreadyAttachedToClaim(claimId, sha256);
          const attachmentId = createAttachmentId();
          this.database.run(
            `INSERT INTO attachments
             (attachment_id, claim_id, original_filename, stored_filename, mime_type, size_bytes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            attachmentId,
            claimId,
            file.originalname,
            file.filename,
            file.mimetype,
            file.size,
            createdAt
          );
          this.database.run(
            `INSERT INTO attachment_fingerprints (attachment_id, sha256)
             VALUES (?, ?)`,
            attachmentId,
            sha256
          );

          return {
            attachmentId,
            originalFilename: file.originalname,
            storedFilename: file.filename,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            documentType: null,
            createdAt: new Date(createdAt),
            analysis: null
          } satisfies StoredAttachment;
        });

        this.database.run(
          "DELETE FROM claim_review_corrections WHERE claim_id = ?",
          claimId
        );
        this.claims.invalidateValidationInCurrentTransaction(memberId, claimId);
        return records;
      });

      return attachments.map(toAttachmentRecord);
    } catch (error) {
      this.removeStoredFiles(files.map((file) => file.filename));
      throw error;
    }
  }

  list(memberId: string, claimId: string) {
    this.claims.findOne(memberId, claimId);
    return this.database
      .all<AttachmentRow>(
        `SELECT attachment_id, original_filename, stored_filename, mime_type,
                size_bytes, document_type, created_at,
                (SELECT result_json FROM extraction_results
                 WHERE extraction_results.attachment_id = attachments.attachment_id
                 ORDER BY id DESC LIMIT 1) AS analysis_json
         FROM attachments
         WHERE claim_id = ?
         ORDER BY created_at ASC, attachment_id ASC`,
        claimId
      )
      .map(mapAttachment)
      .map(toAttachmentRecord);
  }

  findForDownload(memberId: string, claimId: string, attachmentId: string) {
    const attachment = this.findAttachment(memberId, claimId, attachmentId);
    const path = this.resolveStoredPath(attachment.storedFilename);
    if (!existsSync(path)) {
      throw new NotFoundException("Document file is unavailable");
    }

    return { attachment, path };
  }

  findAcceptedForOpsDownload(
    memberId: string,
    claimId: string,
    attachmentId: string
  ) {
    const row = this.database.get<AttachmentRow>(
      `SELECT a.attachment_id, a.original_filename, a.stored_filename,
              a.mime_type, a.size_bytes, a.document_type, a.created_at,
              NULL AS analysis_json
       FROM attachments a
       INNER JOIN claims c ON c.claim_id = a.claim_id
       INNER JOIN claim_submissions s ON s.claim_id = c.claim_id
       WHERE a.claim_id = ? AND a.attachment_id = ?
         AND c.member_id = ?
         AND c.status = 'accepted_for_processing'`,
      claimId,
      attachmentId,
      memberId
    );
    if (!row) {
      throw new NotFoundException("Submitted claim document not found");
    }

    const attachment = mapAttachment(row);
    const path = this.resolveStoredPath(attachment.storedFilename);
    if (!existsSync(path)) {
      throw new NotFoundException("Document file is unavailable");
    }

    return { attachment, path };
  }

  private findAttachment(
    memberId: string,
    claimId: string,
    attachmentId: string
  ) {
    this.claims.findOne(memberId, claimId);
    const row = this.database.get<AttachmentRow>(
      `SELECT attachment_id, original_filename, stored_filename, mime_type,
              size_bytes, document_type, created_at,
              (SELECT result_json FROM extraction_results
               WHERE extraction_results.attachment_id = attachments.attachment_id
               ORDER BY id DESC LIMIT 1) AS analysis_json
       FROM attachments
       WHERE claim_id = ? AND attachment_id = ?`,
      claimId,
      attachmentId
    );

    if (!row) {
      throw new NotFoundException("Document not found");
    }

    return mapAttachment(row);
  }

  remove(memberId: string, claimId: string, attachmentId: string) {
    const attachment = this.findAttachment(memberId, claimId, attachmentId);

    this.database.transaction(() => {
      this.database.run(
        `DELETE FROM attachments
         WHERE claim_id = ? AND attachment_id = ?`,
        claimId,
        attachmentId
      );
      this.database.run(
        "DELETE FROM claim_review_corrections WHERE claim_id = ?",
        claimId
      );
      this.claims.invalidateValidationInCurrentTransaction(memberId, claimId);
    });

    this.removeStoredFiles([attachment.storedFilename]);
  }

  removeStoredFiles(storedFilenames: string[]) {
    for (const storedFilename of storedFilenames) {
      rmSync(this.resolveStoredPath(storedFilename), { force: true });
    }
  }

  private resolveStoredPath(storedFilename: string) {
    const directory = getUploadDirectory();
    const path = resolve(directory, storedFilename);
    const pathRelativeToDirectory = relative(directory, path);

    if (
      pathRelativeToDirectory.startsWith("..") ||
      pathRelativeToDirectory === "" ||
      pathRelativeToDirectory.includes("..\\") ||
      pathRelativeToDirectory.includes("../")
    ) {
      throw new BadRequestException("Invalid document reference");
    }

    return path;
  }

  private fileHash(storedFilename: string) {
    return createHash("sha256")
      .update(readFileSync(this.resolveStoredPath(storedFilename)))
      .digest("hex");
  }

  private assertUniqueUploadBatch(hashes: string[]) {
    if (new Set(hashes).size !== hashes.length) {
      throw new BadRequestException(
        "The same document was selected more than once."
      );
    }
  }

  private assertClaimAttachmentLimit(claimId: string, incomingCount: number) {
    const row = this.database.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM attachments WHERE claim_id = ?",
      claimId
    );
    if ((row?.count ?? 0) + incomingCount > MAX_CLAIM_ATTACHMENTS) {
      throw new BadRequestException(
        `You can attach up to ${MAX_CLAIM_ATTACHMENTS} documents to one claim. Remove a document before adding another.`
      );
    }
  }

  private assertFileSignatures(files: UploadedAttachmentFile[]) {
    for (const file of files) {
      const bytes = readFileSync(this.resolveStoredPath(file.filename)).subarray(0, 8);
      const valid = file.mimetype === "application/pdf"
        ? bytes.subarray(0, 5).toString("ascii") === "%PDF-"
        : file.mimetype === "image/png"
          ? bytes.equals(
              Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
            )
          : file.mimetype === "image/jpeg"
            ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
            : false;

      if (!valid) {
        throw new BadRequestException(
          `${file.originalname} is not a valid PDF, JPG, or PNG document.`
        );
      }
    }
  }

  private assertFileSizes(files: UploadedAttachmentFile[]) {
    for (const file of files) {
      const size = statSync(this.resolveStoredPath(file.filename)).size;
      if (size > MAX_UPLOAD_FILE_SIZE_BYTES) {
        throw new BadRequestException(
          "Each document must be 10 MB or smaller."
        );
      }
    }
  }

  private assertNotAlreadyAttachedToClaim(claimId: string, sha256: string) {
    const duplicate = this.database.get<{ attachment_id: string }>(
      `SELECT a.attachment_id
       FROM attachment_fingerprints f
       INNER JOIN attachments a ON a.attachment_id = f.attachment_id
       WHERE a.claim_id = ? AND f.sha256 = ?
       LIMIT 1`,
      claimId,
      sha256
    );
    if (duplicate) {
      throw new BadRequestException(
        "This document is already attached to this claim."
      );
    }
  }
}
