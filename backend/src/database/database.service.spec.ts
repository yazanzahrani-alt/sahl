import { ConfigService } from "@nestjs/config";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DatabaseService } from "./database.service";

describe("DatabaseService additive validation migration", () => {
  it("adds evidence-unit identity and detail columns to a legacy database", () => {
    const directory = mkdtempSync(join(tmpdir(), "sahl-db-migration-"));
    const databasePath = join(directory, "legacy.db");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE validation_issues (
        id INTEGER PRIMARY KEY,
        claim_id TEXT NOT NULL,
        attachment_id TEXT,
        code TEXT NOT NULL,
        field TEXT,
        message TEXT NOT NULL,
        state TEXT NOT NULL,
        resolved_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE validation_confirmations (
        issue_key TEXT PRIMARY KEY,
        claim_id TEXT NOT NULL,
        code TEXT NOT NULL,
        attachment_id TEXT,
        confirmed_at TEXT NOT NULL
      );
      INSERT INTO validation_issues
        (id, claim_id, attachment_id, code, field, message, state, resolved_at, created_at)
      VALUES
        (7, 'CLM-LEGACY', 'ATT-LEGACY', 'legacy_warning', 'providerName',
         'Keep this legacy message.', 'needs_review', NULL, '2026-08-01T00:00:00.000Z');
      INSERT INTO validation_confirmations
        (issue_key, claim_id, code, attachment_id, confirmed_at)
      VALUES
        ('legacy_warning|ATT-LEGACY', 'CLM-LEGACY', 'legacy_warning',
         'ATT-LEGACY', '2026-08-02T00:00:00.000Z');
    `);
    legacy.close();

    let service: DatabaseService | null = null;
    try {
      for (let startup = 0; startup < 3; startup += 1) {
        service = new DatabaseService(new ConfigService({ SQLITE_PATH: databasePath }));
        service.onModuleInit();
        const issueColumns = service.all<{ name: string }>("PRAGMA table_info(validation_issues)")
          .map((column) => column.name);
        const confirmationColumns = service
          .all<{ name: string }>("PRAGMA table_info(validation_confirmations)")
          .map((column) => column.name);

        expect(issueColumns).toEqual(expect.arrayContaining([
          "evidence_unit_id",
          "page_start",
          "page_end",
          "message_ar",
          "details_json",
          "details_ar_json"
        ]));
        expect(confirmationColumns).toContain("evidence_unit_id");
        expect(service.get<Record<string, unknown>>(
          "SELECT * FROM validation_issues WHERE id = 7"
        )).toMatchObject({
          claim_id: "CLM-LEGACY",
          attachment_id: "ATT-LEGACY",
          code: "legacy_warning",
          field: "providerName",
          message: "Keep this legacy message.",
          state: "needs_review",
          created_at: "2026-08-01T00:00:00.000Z",
          evidence_unit_id: null,
          page_start: null,
          page_end: null
        });
        expect(service.get<Record<string, unknown>>(
          "SELECT * FROM validation_confirmations WHERE issue_key = ?",
          "legacy_warning|ATT-LEGACY"
        )).toMatchObject({
          claim_id: "CLM-LEGACY",
          code: "legacy_warning",
          attachment_id: "ATT-LEGACY",
          confirmed_at: "2026-08-02T00:00:00.000Z",
          evidence_unit_id: null
        });
        service.onApplicationShutdown();
        service = null;
      }
    } finally {
      service?.onApplicationShutdown();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
