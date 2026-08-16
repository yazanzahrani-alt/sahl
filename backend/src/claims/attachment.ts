import { BadRequestException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { diskStorage } from "multer";
import type { MulterOptions } from "@nestjs/platform-express/multer/interfaces/multer-options.interface";
import type { DocumentAnalysisResult } from "../document-intelligence/document-analysis";

export const MAX_UPLOAD_FILES = 10;
export const MAX_CLAIM_ATTACHMENTS = 10;
export const MAX_UPLOAD_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const SUPPORTED_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png"]);
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png"
]);

export interface UploadedAttachmentFile {
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface AttachmentRecord {
  attachmentId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  documentType: string | null;
  createdAt: Date;
  analysis: DocumentAnalysisResult | null;
}

export interface StoredAttachment extends AttachmentRecord {
  storedFilename: string;
}

export function getUploadDirectory() {
  const directory = resolve(process.env.UPLOADS_PATH ?? "./data/uploads");
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function createStoredFilename(originalName: string) {
  const extension = extname(basename(originalName)).toLowerCase();
  return `${randomBytes(18).toString("hex")}${extension}`;
}

export function validateUploadFile(file: {
  originalname: string;
  mimetype: string;
}) {
  const extension = extname(basename(file.originalname)).toLowerCase();
  if (
    !SUPPORTED_EXTENSIONS.has(extension) ||
    !SUPPORTED_MIME_TYPES.has(file.mimetype)
  ) {
    throw new BadRequestException(
      "Upload a PDF, JPG, JPEG, or PNG document."
    );
  }
}

export function createAttachmentId() {
  return `ATT-${randomBytes(9).toString("hex").toUpperCase()}`;
}

export const claimUploadOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_request, _file, callback) => {
      callback(null, getUploadDirectory());
    },
    filename: (_request, file, callback) => {
      callback(null, createStoredFilename(file.originalname));
    }
  }),
  limits: {
    fileSize: MAX_UPLOAD_FILE_SIZE_BYTES,
    files: MAX_UPLOAD_FILES
  },
  fileFilter: (_request, file, callback) => {
    try {
      validateUploadFile(file);
      callback(null, true);
    } catch (error) {
      callback(error as Error, false);
    }
  }
};
