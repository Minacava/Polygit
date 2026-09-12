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
