export {
  DB_RELATIVE_PATH,
  openDatabase,
  migrate,
  resolveDbPath,
} from "./core/db.js";

export type {
  DocumentFormat,
  DocumentRow,
  GlossaryRow,
  GlossaryUsageRow,
  SegmentRow,
  SegmentStatus,
  TranslationMemoryRow,
  TranslationRow,
  TranslationSource,
} from "./core/db.js";

export {
  createSegmentId,
  createId,
  normalizeText,
  segmentProse,
} from "./core/segmenter.js";

export {
  matchTranslationMemory,
  similarity,
  DEFAULT_FUZZY_THRESHOLD,
} from "./core/matcher.js";

export { getPackageVersion } from "./version.js";
