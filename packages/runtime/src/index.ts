export {
  type CheckOutcome,
  parseAddedLines,
  parseNameStatus,
  runTier1,
  type Side,
  type Tier1Options,
  type Tier1Result,
} from "./judge/tier1.js";
export {
  type DiffEntry,
  findProtected,
  isProtectedConfig,
  isTestFile,
  PROTECTED,
  type ProtectedFinding,
  type ProtectedReason,
} from "./judge/protected.js";
