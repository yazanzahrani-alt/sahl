import { ConfigService } from "@nestjs/config";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseService } from "../database/database.service";
import { OpsService } from "./ops.service";

describe("OpsService member scoping", () => {
  let directory: string;
  let database: DatabaseService;
  let ops: OpsService;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "sahl-ops-"));
    database = new DatabaseService(new ConfigService({
      SQLITE_PATH: join(directory, "sahl.db")
    }));
    database.onModuleInit();
    ops = new OpsService(database);

    for (const memberId of ["00123456", "87654321"]) {
      database.run(
        `INSERT INTO members (member_id, member_id_source, password_hash, created_at)
         VALUES (?, 'provided', 'test-hash', ?)`,
        memberId,
        new Date().toISOString()
      );
      const claimId = `CLM-${memberId}`;
      database.run(
        `INSERT INTO claims
         (claim_id, member_id, category, optical_item, claim_location, status, created_at, updated_at)
         VALUES (?, ?, 'dental', NULL, 'local', 'accepted_for_processing', ?, ?)`,
        claimId,
        memberId,
        new Date().toISOString(),
        new Date().toISOString()
      );
      database.run(
        `INSERT INTO claim_submissions
         (claim_id, acceptance_reference, payload_json, submitted_at)
         VALUES (?, ?, '{}', ?)`,
        claimId,
        `ACC-${memberId}`,
        new Date().toISOString()
      );
    }
  });

  afterEach(() => {
    database.onApplicationShutdown();
    rmSync(directory, { recursive: true, force: true });
  });

  it("returns only the authenticated member's accepted claims", () => {
    expect(ops.listAccepted("00123456").map((claim) => claim.claimId)).toEqual([
      "CLM-00123456"
    ]);
    expect(ops.listAccepted("87654321").map((claim) => claim.claimId)).toEqual([
      "CLM-87654321"
    ]);
  });
});
