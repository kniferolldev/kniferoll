import { parseDocument } from "./parser";
import type { DocumentParseResult } from "./types";

export type CheckResult = DocumentParseResult;

export const runChecks = (content: string): CheckResult => {
  return parseDocument(content);
};
