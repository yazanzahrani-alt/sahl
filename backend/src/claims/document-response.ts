import type { Response } from "express";

interface DownloadableDocument {
  originalFilename: string;
  mimeType: string;
}

export function setDocumentResponseHeaders(
  response: Response,
  document: DownloadableDocument
) {
  const encodedFilename = encodeURIComponent(document.originalFilename)
    .replace(/[!'()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );

  response.set({
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `inline; filename*=UTF-8''${encodedFilename}`
  });
  response.type(document.mimeType);
}
