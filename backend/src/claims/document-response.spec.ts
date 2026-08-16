import type { Response } from "express";
import { setDocumentResponseHeaders } from "./document-response";

describe("document download response", () => {
  it("sets defensive cache, sniffing, type, and disposition headers", () => {
    const set = jest.fn();
    const type = jest.fn();

    setDocumentResponseHeaders({ set, type } as unknown as Response, {
      originalFilename: "medical report.pdf",
      mimeType: "application/pdf"
    });

    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline; filename*=UTF-8''medical%20report.pdf"
    }));
    expect(type).toHaveBeenCalledWith("application/pdf");
  });
});
