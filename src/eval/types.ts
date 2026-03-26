/**
 * Shared types for the eval pipeline
 */

import type { ComparisonResult } from "./compare";
import type { InferenceMetrics } from "../import";

/** Result for a single test case */
export interface TestCaseResult {
  id: string;
  parsed: boolean;
  errorCount: number;
  warningCount: number;
  /** Structured comparison score (0-100) */
  score: number;
  /** Detailed comparison result */
  comparison?: ComparisonResult;
  actual: string;
  importMetrics?: InferenceMetrics;
}

/** Metadata about the eval run */
export interface EvalMetadata {
  /** Model used for import, e.g. "google/gemini-3-flash-preview" */
  importerModel?: string;
}

/** Baseline data structure */
export interface Baseline {
  timestamp: string;
  metadata: EvalMetadata;
  results: Record<string, TestCaseResult>;
  summary: {
    parseRate: number;
    avgScore: number;
    totalDurationMs?: number;
    totalInputTokens?: number;
    totalOutputTokens?: number;
  };
}
