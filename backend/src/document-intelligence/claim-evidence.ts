import {
  getEvidenceUnits,
  type DocumentAnalysisResult,
  type EvidenceUnit
} from "./document-analysis";

export interface ClaimEvidenceUnit extends EvidenceUnit {
  schemaVersion: number;
  extractionVersion: string;
  analysisStatus: DocumentAnalysisResult["analysisStatus"];
  provider: string;
  model: string | null;
  analysedAt: string;
}

export function claimEvidenceUnits(
  analyses: readonly DocumentAnalysisResult[]
): ClaimEvidenceUnit[] {
  return analyses.flatMap((analysis) =>
    getEvidenceUnits(analysis).map((unit) => ({
      ...unit,
      schemaVersion: analysis.schemaVersion,
      extractionVersion: analysis.extractionVersion,
      analysisStatus: analysis.analysisStatus,
      provider: analysis.provider,
      model: analysis.model,
      analysedAt: analysis.analysedAt
    }))
  );
}
