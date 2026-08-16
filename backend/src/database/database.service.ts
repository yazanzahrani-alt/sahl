import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const CREATE_MEMBERS_TABLE = `
  CREATE TABLE IF NOT EXISTS members (
    member_id TEXT PRIMARY KEY
      CHECK (length(member_id) = 8 AND member_id NOT GLOB '*[^0-9]*'),
    member_id_source TEXT NOT NULL
      CHECK (member_id_source IN ('provided', 'synthetic')),
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`;

const CREATE_MEMBER_IDENTIFIERS_TABLE = `
  CREATE TABLE IF NOT EXISTS member_identifiers (
    member_id TEXT NOT NULL,
    identifier TEXT NOT NULL UNIQUE,
    identifier_type TEXT NOT NULL
      CHECK (identifier_type IN ('member_id', 'national_id', 'iqama_id')),
    CHECK (
      (identifier_type = 'member_id'
        AND length(identifier) = 8
        AND identifier NOT GLOB '*[^0-9]*')
      OR
      (identifier_type = 'national_id'
        AND length(identifier) = 10
        AND substr(identifier, 1, 1) = '1'
        AND identifier NOT GLOB '*[^0-9]*')
      OR
      (identifier_type = 'iqama_id'
        AND length(identifier) = 10
        AND substr(identifier, 1, 1) = '2'
        AND identifier NOT GLOB '*[^0-9]*')
    ),
    PRIMARY KEY (member_id, identifier),
    FOREIGN KEY (member_id) REFERENCES members(member_id) ON DELETE CASCADE
  )
`;

const CREATE_CLAIMS_TABLE = `
  CREATE TABLE IF NOT EXISTS claims (
    claim_id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    category TEXT NOT NULL
      CHECK (category IN ('inpatient_surgery', 'dental', 'optical', 'other_outpatient')),
    optical_item TEXT
      CHECK (optical_item IS NULL OR optical_item IN ('frames', 'lenses', 'both')),
    claim_location TEXT NOT NULL
      CHECK (claim_location IN ('local', 'international')),
    status TEXT NOT NULL
      CHECK (status IN ('draft', 'processing', 'needs_review', 'ready', 'accepted_for_processing')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (member_id) REFERENCES members(member_id) ON DELETE CASCADE
  )
`;

const CREATE_ATTACHMENTS_TABLE = `
  CREATE TABLE IF NOT EXISTS attachments (
    attachment_id TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    document_type TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (claim_id) REFERENCES claims(claim_id) ON DELETE CASCADE
  )
`;

const CREATE_EXTRACTION_RESULTS_TABLE = `
  CREATE TABLE IF NOT EXISTS extraction_results (
    id INTEGER PRIMARY KEY,
    attachment_id TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (attachment_id) REFERENCES attachments(attachment_id)
      ON DELETE CASCADE
  )
`;

const CREATE_ATTACHMENT_FINGERPRINTS_TABLE = `
  CREATE TABLE IF NOT EXISTS attachment_fingerprints (
    attachment_id TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL,
    FOREIGN KEY (attachment_id) REFERENCES attachments(attachment_id)
      ON DELETE CASCADE
  )
`;

const CREATE_VALIDATION_ISSUES_TABLE = `
  CREATE TABLE IF NOT EXISTS validation_issues (
    id INTEGER PRIMARY KEY,
    claim_id TEXT NOT NULL,
    attachment_id TEXT,
    evidence_unit_id TEXT,
    page_start INTEGER,
    page_end INTEGER,
    code TEXT NOT NULL,
    field TEXT,
    message TEXT NOT NULL,
    message_ar TEXT,
    details_json TEXT,
    details_ar_json TEXT,
    state TEXT NOT NULL
      CHECK (state IN ('ready', 'needs_review', 'conflict', 'missing', 'invalid')),
    resolved_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (claim_id) REFERENCES claims(claim_id) ON DELETE CASCADE,
    FOREIGN KEY (attachment_id) REFERENCES attachments(attachment_id)
      ON DELETE CASCADE
  )
`;

const CREATE_CLAIM_REVIEW_CORRECTIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS claim_review_corrections (
    claim_id TEXT PRIMARY KEY,
    corrected_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (claim_id) REFERENCES claims(claim_id)
      ON DELETE CASCADE
  )
`;

const CREATE_VALIDATION_CONFIRMATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS validation_confirmations (
    issue_key TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL,
    code TEXT NOT NULL,
    attachment_id TEXT,
    evidence_unit_id TEXT,
    confirmed_at TEXT NOT NULL,
    FOREIGN KEY (claim_id) REFERENCES claims(claim_id)
      ON DELETE CASCADE,
    FOREIGN KEY (attachment_id) REFERENCES attachments(attachment_id)
      ON DELETE CASCADE
  )
`;

const CREATE_CLAIM_SUBMISSIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS claim_submissions (
    claim_id TEXT PRIMARY KEY,
    acceptance_reference TEXT NOT NULL UNIQUE,
    payload_json TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    FOREIGN KEY (claim_id) REFERENCES claims(claim_id) ON DELETE CASCADE
  )
`;

const CREATE_SUBMISSION_FINGERPRINTS_TABLE = `
  CREATE TABLE IF NOT EXISTS submission_fingerprints (
    claim_id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    FOREIGN KEY (claim_id) REFERENCES claim_submissions(claim_id)
      ON DELETE CASCADE
  )
`;

const CREATE_CLAIM_INDEXES = `
  CREATE INDEX IF NOT EXISTS claims_member_updated_idx
    ON claims(member_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS attachments_claim_idx
    ON attachments(claim_id);
  CREATE INDEX IF NOT EXISTS attachment_fingerprints_sha256_idx
    ON attachment_fingerprints(sha256);
  CREATE INDEX IF NOT EXISTS submission_fingerprints_fingerprint_idx
    ON submission_fingerprints(fingerprint);
`;

@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  private readonly database: DatabaseSync;

  constructor(config: ConfigService) {
    const databasePath = resolve(
      config.get<string>("SQLITE_PATH", "./data/sahl.db")
    );
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
  }

  onModuleInit() {
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      ${CREATE_MEMBERS_TABLE};
      ${CREATE_MEMBER_IDENTIFIERS_TABLE};
      ${CREATE_CLAIMS_TABLE};
      ${CREATE_ATTACHMENTS_TABLE};
      ${CREATE_EXTRACTION_RESULTS_TABLE};
      ${CREATE_ATTACHMENT_FINGERPRINTS_TABLE};
      ${CREATE_VALIDATION_ISSUES_TABLE};
      ${CREATE_CLAIM_REVIEW_CORRECTIONS_TABLE};
      ${CREATE_VALIDATION_CONFIRMATIONS_TABLE};
      ${CREATE_CLAIM_SUBMISSIONS_TABLE};
      ${CREATE_SUBMISSION_FINGERPRINTS_TABLE};
      ${CREATE_CLAIM_INDEXES};
    `);
    this.ensureColumn("validation_issues", "evidence_unit_id", "TEXT");
    this.ensureColumn("validation_issues", "page_start", "INTEGER");
    this.ensureColumn("validation_issues", "page_end", "INTEGER");
    this.ensureColumn("validation_issues", "message_ar", "TEXT");
    this.ensureColumn("validation_issues", "details_json", "TEXT");
    this.ensureColumn("validation_issues", "details_ar_json", "TEXT");
    this.ensureColumn("validation_confirmations", "evidence_unit_id", "TEXT");
  }

  get<T>(sql: string, ...values: SQLInputValue[]) {
    return this.database.prepare(sql).get(...values) as T | undefined;
  }

  all<T>(sql: string, ...values: SQLInputValue[]) {
    return this.database.prepare(sql).all(...values) as T[];
  }

  run(sql: string, ...values: SQLInputValue[]) {
    return this.database.prepare(sql).run(...values);
  }

  transaction<T>(operation: () => T) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  onApplicationShutdown() {
    this.database.close();
  }

  private ensureColumn(table: string, column: string, declaration: string) {
    const existing = this.database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>;
    if (!existing.some((item) => item.name === column)) {
      this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
    }
  }

}
