import type Database from "better-sqlite3";
import type {
  DocumentFormat,
  DocumentRow,
  GlossaryRow,
  SegmentRow,
  SegmentStatus,
  TranslationMemoryRow,
  TranslationLangStatus,
  TranslationRow,
  TranslationSource,
} from "./db.js";
import { similarity } from "./matcher.js";
import { nowIso } from "./project.js";
import {
  assignStableSegmentIds,
  createId,
  normalizeText,
  type RawSegment,
} from "./segmenter.js";

/** Minimum similarity to treat a source edit as the same segment (keep translations as stale). */
const EDIT_MATCH_THRESHOLD = 0.5;

export function upsertDocument(
  db: Database.Database,
  relativePath: string,
  format: DocumentFormat,
  contentHash?: string | null,
): DocumentRow {
  const existing = db
    .prepare(`SELECT * FROM documents WHERE path = ?`)
    .get(relativePath) as DocumentRow | undefined;

  const ts = nowIso();
  const hash =
    contentHash === undefined
      ? (existing?.content_hash ?? null)
      : contentHash;

  if (existing) {
    db.prepare(
      `UPDATE documents SET format = ?, updated_at = ?, content_hash = ? WHERE id = ?`,
    ).run(format, ts, hash, existing.id);
    return { ...existing, format, updated_at: ts, content_hash: hash };
  }

  const row: DocumentRow = {
    id: createId("doc"),
    path: relativePath,
    format,
    imported_at: ts,
    updated_at: ts,
    content_hash: hash,
  };
  db.prepare(
    `INSERT INTO documents (id, path, format, imported_at, updated_at, content_hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.path, row.format, row.imported_at, row.updated_at, row.content_hash);
  return row;
}

/**
 * Upsert segments for a document.
 *
 * IDs are stable hashes of path + content + occurrence (not position), so
 * inserting a paragraph keeps translations on unchanged segments. When source
 * text is edited, we reuse the closest unmatched prior segment id and mark its
 * translations as `stale` instead of deleting them.
 */
export function replaceDocumentSegments(
  db: Database.Database,
  document: DocumentRow,
  rawSegments: RawSegment[],
): { inserted: number; unchanged: number; removed: number; updated: number } {
  const existing = db
    .prepare(`SELECT * FROM segments WHERE document_id = ?`)
    .all(document.id) as SegmentRow[];
  const existingById = new Map(existing.map((s) => [s.id, s]));
  const desired = assignStableSegmentIds(document.path, rawSegments);

  let inserted = 0;
  let unchanged = 0;
  let updated = 0;
  let removed = 0;
  const ts = nowIso();

  const run = db.transaction(() => {
    const keptIds = new Set<string>();
    const unmatchedNew: typeof desired = [];

    for (const next of desired) {
      const prev = existingById.get(next.id);
      if (prev && normalizeText(prev.source_text) === normalizeText(next.sourceText)) {
        db.prepare(`UPDATE segments SET order_index = ?, updated_at = ? WHERE id = ?`).run(
          next.orderIndex,
          ts,
          next.id,
        );
        keptIds.add(next.id);
        unchanged += 1;
        continue;
      }
      unmatchedNew.push(next);
    }

    const unmatchedOld = existing.filter((s) => !keptIds.has(s.id));

    // Pair source edits: reuse old ids so translations survive as stale.
    const pairedNew = new Set<string>();
    const pairedOld = new Set<string>();
    for (const next of unmatchedNew) {
      let best: { old: SegmentRow; score: number } | null = null;
      for (const old of unmatchedOld) {
        if (pairedOld.has(old.id)) continue;
        const score = similarity(
          normalizeText(next.sourceText),
          normalizeText(old.source_text),
        );
        if (score < EDIT_MATCH_THRESHOLD) continue;
        if (!best || score > best.score) best = { old, score };
      }
      if (!best) continue;

      pairedNew.add(next.id);
      pairedOld.add(best.old.id);
      keptIds.add(best.old.id);

      db.prepare(
        `UPDATE segments SET order_index = ?, source_text = ?, status = 'stale', updated_at = ? WHERE id = ?`,
      ).run(next.orderIndex, next.sourceText, ts, best.old.id);
      db.prepare(
        `UPDATE translations SET status = 'stale', approved = 0, updated_at = ? WHERE segment_id = ?`,
      ).run(ts, best.old.id);
      updated += 1;
    }

    for (const next of unmatchedNew) {
      if (pairedNew.has(next.id)) continue;
      db.prepare(
        `INSERT INTO segments (id, document_id, order_index, source_text, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      ).run(next.id, document.id, next.orderIndex, next.sourceText, ts, ts);
      keptIds.add(next.id);
      inserted += 1;
    }

    for (const old of existing) {
      if (keptIds.has(old.id)) continue;
      db.prepare(`DELETE FROM segments WHERE id = ?`).run(old.id);
      removed += 1;
    }
  });

  run();
  return { inserted, unchanged, removed, updated };
}

/**
 * Segments that still need work for a target language:
 * - no translation row for `lang`, or
 * - segment is marked stale (e.g. after glossary sync).
 *
 * This is per-language so `translate fr` then `translate es` both work.
 */
export function listSegmentsForTranslate(
  db: Database.Database,
  opts: {
    lang: string;
    documentPath?: string;
    segmentIds?: string[];
  },
): Array<SegmentRow & { document_path: string; document_format: DocumentFormat }> {
  const params: unknown[] = [opts.lang];

  let sql = `
    SELECT s.*, d.path AS document_path, d.format AS document_format
    FROM segments s
    JOIN documents d ON d.id = s.document_id
    LEFT JOIN translations t ON t.segment_id = s.id AND t.lang = ?
    WHERE (t.id IS NULL OR t.status = 'stale')
  `;

  if (opts.documentPath) {
    sql += ` AND d.path = ?`;
    params.push(opts.documentPath);
  }
  if (opts.segmentIds?.length) {
    sql += ` AND s.id IN (${opts.segmentIds.map(() => "?").join(", ")})`;
    params.push(...opts.segmentIds);
  }

  sql += ` ORDER BY d.path ASC, s.order_index ASC`;
  return db.prepare(sql).all(...params) as Array<
    SegmentRow & { document_path: string; document_format: DocumentFormat }
  >;
}

export function getTmEntries(db: Database.Database, lang: string): TranslationMemoryRow[] {
  return db
    .prepare(`SELECT * FROM translation_memory WHERE lang = ?`)
    .all(lang) as TranslationMemoryRow[];
}

export function upsertTranslation(
  db: Database.Database,
  segmentId: string,
  lang: string,
  targetText: string,
  source: TranslationSource,
  approved = false,
  styleHash: string | null = null,
): void {
  const ts = nowIso();
  const langStatus = approved ? "approved" : "translated";
  const existing = db
    .prepare(`SELECT id FROM translations WHERE segment_id = ? AND lang = ?`)
    .get(segmentId, lang) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE translations
       SET target_text = ?, source = ?, status = ?, approved = ?, updated_at = ?, style_hash = ?
       WHERE id = ?`,
    ).run(targetText, source, langStatus, approved ? 1 : 0, ts, styleHash, existing.id);
  } else {
    db.prepare(
      `INSERT INTO translations
         (id, segment_id, lang, target_text, source, status, approved, updated_at, style_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      createId("tr"),
      segmentId,
      lang,
      targetText,
      source,
      langStatus,
      approved ? 1 : 0,
      ts,
      styleHash,
    );
  }

  // Keep segment row as a coarse rollup only (pending → translated once any lang exists).
  // Do not overwrite approved/stale of other languages via this global field.
  const seg = db
    .prepare(`SELECT status FROM segments WHERE id = ?`)
    .get(segmentId) as { status: SegmentStatus } | undefined;
  if (seg && seg.status === "pending") {
    db.prepare(`UPDATE segments SET status = 'translated', updated_at = ? WHERE id = ?`).run(
      ts,
      segmentId,
    );
  } else {
    db.prepare(`UPDATE segments SET updated_at = ? WHERE id = ?`).run(ts, segmentId);
  }
}

export function upsertTranslationMemory(
  db: Database.Database,
  sourceText: string,
  targetText: string,
  lang: string,
  styleHash: string | null = null,
): void {
  const normalized = normalizeText(sourceText);
  const hit = db
    .prepare(`SELECT id FROM translation_memory WHERE lang = ? AND source_norm = ?`)
    .get(lang, normalized) as { id: string } | undefined;
  const ts = nowIso();
  if (hit) {
    db.prepare(
      `UPDATE translation_memory
       SET target_text = ?, usage_count = usage_count + 1, updated_at = ?, style_hash = ?
       WHERE id = ?`,
    ).run(targetText, ts, styleHash, hit.id);
  } else {
    db.prepare(
      `INSERT INTO translation_memory
         (id, source_text, target_text, lang, usage_count, updated_at, source_norm, style_hash)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
    ).run(createId("tm"), sourceText, targetText, lang, ts, normalized, styleHash);
  }
}

/**
 * Mark translations whose style_hash differs from `currentHash` as stale.
 * When `currentHash` is null (no style configured), marks nothing.
 * Keeps target_text; clears approved until retranslate. Returns affected segment ids.
 */
export function markStyleHashStale(
  db: Database.Database,
  currentHash: string | null,
  lang?: string,
): string[] {
  if (currentHash === null) return [];

  const ts = nowIso();
  const rows = (
    lang
      ? db
          .prepare(
            `SELECT segment_id, style_hash, status FROM translations WHERE lang = ?`,
          )
          .all(lang)
      : db.prepare(`SELECT segment_id, style_hash, status, lang FROM translations`).all()
  ) as Array<{
    segment_id: string;
    style_hash: string | null;
    status: string;
    lang?: string;
  }>;

  const segmentIds: string[] = [];
  const update = db.prepare(
    `UPDATE translations
     SET status = 'stale', approved = 0, updated_at = ?
     WHERE segment_id = ? AND lang = ?`,
  );

  for (const row of rows) {
    const stored = row.style_hash ?? null;
    if (stored === currentHash) continue;
    const rowLang = lang ?? row.lang;
    if (!rowLang) continue;
    update.run(ts, row.segment_id, rowLang);
    if (!segmentIds.includes(row.segment_id)) segmentIds.push(row.segment_id);
  }
  return segmentIds;
}

/**
 * Mark translations stale when their stored style_hash differs from the
 * expected hash for that document (path/lang-aware styles).
 */
export function markStyleHashStaleByExpected(
  db: Database.Database,
  lang: string,
  expectedHashForDocument: (documentPath: string) => string | null,
): string[] {
  const ts = nowIso();
  const rows = db
    .prepare(
      `SELECT t.segment_id AS segment_id, t.style_hash AS style_hash, d.path AS document_path
       FROM translations t
       JOIN segments s ON s.id = t.segment_id
       JOIN documents d ON d.id = s.document_id
       WHERE t.lang = ?`,
    )
    .all(lang) as Array<{
    segment_id: string;
    style_hash: string | null;
    document_path: string;
  }>;

  const segmentIds: string[] = [];
  const update = db.prepare(
    `UPDATE translations
     SET status = 'stale', approved = 0, updated_at = ?
     WHERE segment_id = ? AND lang = ?`,
  );

  for (const row of rows) {
    const expected = expectedHashForDocument(row.document_path);
    const stored = row.style_hash ?? null;
    if (stored === expected) continue;
    update.run(ts, row.segment_id, lang);
    if (!segmentIds.includes(row.segment_id)) segmentIds.push(row.segment_id);
  }
  return segmentIds;
}

export function getGlossary(db: Database.Database, lang?: string): GlossaryRow[] {
  if (lang) {
    return db.prepare(`SELECT * FROM glossary WHERE lang = ?`).all(lang) as GlossaryRow[];
  }
  return db.prepare(`SELECT * FROM glossary`).all() as GlossaryRow[];
}

export function upsertGlossaryTerm(
  db: Database.Database,
  sourceTerm: string,
  targetTerm: string,
  lang: string,
  note?: string,
): { row: GlossaryRow; changed: boolean } {
  const ts = nowIso();
  const existing = db
    .prepare(`SELECT * FROM glossary WHERE source_term = ? AND lang = ?`)
    .get(sourceTerm, lang) as GlossaryRow | undefined;

  if (existing) {
    const changed =
      existing.target_term !== targetTerm || (existing.note ?? "") !== (note ?? "");
    db.prepare(
      `UPDATE glossary SET target_term = ?, note = ?, updated_at = ? WHERE id = ?`,
    ).run(targetTerm, note ?? null, ts, existing.id);
    return {
      row: { ...existing, target_term: targetTerm, note: note ?? null, updated_at: ts },
      changed,
    };
  }

  const row: GlossaryRow = {
    id: createId("gl"),
    source_term: sourceTerm,
    target_term: targetTerm,
    lang,
    note: note ?? null,
    updated_at: ts,
  };
  db.prepare(
    `INSERT INTO glossary (id, source_term, target_term, lang, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.source_term, row.target_term, row.lang, row.note, row.updated_at);
  return { row, changed: true };
}

export function rebuildGlossaryUsage(db: Database.Database, glossaryId?: string): number {
  const terms = glossaryId
    ? (db.prepare(`SELECT * FROM glossary WHERE id = ?`).all(glossaryId) as GlossaryRow[])
    : (db.prepare(`SELECT * FROM glossary`).all() as GlossaryRow[]);

  let links = 0;
  const tx = db.transaction(() => {
    if (glossaryId) {
      db.prepare(`DELETE FROM glossary_usage WHERE glossary_id = ?`).run(glossaryId);
    } else {
      db.prepare(`DELETE FROM glossary_usage`).run();
    }

    const segments = db.prepare(`SELECT id, source_text FROM segments`).all() as Array<{
      id: string;
      source_text: string;
    }>;
    const insert = db.prepare(
      `INSERT OR IGNORE INTO glossary_usage (glossary_id, segment_id) VALUES (?, ?)`,
    );

    for (const term of terms) {
      const needle = term.source_term.trim();
      if (!needle) continue;
      // Word-boundary match (case-insensitive); escapes regex metacharacters.
      const pattern = new RegExp(
        `(?:^|[^\\p{L}\\p{N}_])${escapeRegExp(needle)}(?:[^\\p{L}\\p{N}_]|$)`,
        "iu",
      );
      for (const segment of segments) {
        if (pattern.test(segment.source_text)) {
          insert.run(term.id, segment.id);
          links += 1;
        }
      }
    }
  });
  tx();
  return links;
}

export function markGlossarySegmentsStale(
  db: Database.Database,
  glossaryIds: string[],
  lang?: string,
): string[] {
  if (glossaryIds.length === 0) return [];
  const ts = nowIso();
  const segmentIds = new Set<string>();
  const select = db.prepare(`SELECT segment_id FROM glossary_usage WHERE glossary_id = ?`);
  for (const id of glossaryIds) {
    for (const row of select.all(id) as Array<{ segment_id: string }>) {
      segmentIds.add(row.segment_id);
    }
  }

  // Prefer per-language stale on translations; fall back to segment stale only when lang omitted.
  if (lang) {
    const updateExisting = db.prepare(
      `UPDATE translations
       SET status = 'stale', approved = 0, updated_at = ?
       WHERE segment_id = ? AND lang = ?`,
    );
    for (const segmentId of segmentIds) {
      updateExisting.run(ts, segmentId, lang);
    }
  } else {
    // Legacy: mark segment stale (affects all langs via list query only if translation missing status — avoided).
    // Still clear approved on ALL translation rows for those segments so publish gate blocks.
    const updateSeg = db.prepare(
      `UPDATE segments SET status = 'stale', updated_at = ? WHERE id = ?`,
    );
    const updateTr = db.prepare(
      `UPDATE translations SET status = 'stale', approved = 0, updated_at = ? WHERE segment_id = ?`,
    );
    for (const segmentId of segmentIds) {
      updateSeg.run(ts, segmentId);
      updateTr.run(ts, segmentId);
    }
  }
  return [...segmentIds];
}

export function getDocumentByPath(
  db: Database.Database,
  relativePath: string,
): DocumentRow | undefined {
  return db.prepare(`SELECT * FROM documents WHERE path = ?`).get(relativePath) as
    | DocumentRow
    | undefined;
}

export function getSegmentsForDocument(
  db: Database.Database,
  documentId: string,
): SegmentRow[] {
  return db
    .prepare(`SELECT * FROM segments WHERE document_id = ? ORDER BY order_index ASC`)
    .all(documentId) as SegmentRow[];
}

export function getTranslationMap(
  db: Database.Database,
  documentId: string,
  lang: string,
): Map<string, TranslationRow> {
  const rows = db
    .prepare(
      `SELECT t.* FROM translations t
       JOIN segments s ON s.id = t.segment_id
       WHERE s.document_id = ? AND t.lang = ?`,
    )
    .all(documentId, lang) as TranslationRow[];
  return new Map(rows.map((r) => [r.segment_id, r]));
}

export function listReviewSegments(
  db: Database.Database,
  opts: { lang?: string; status?: SegmentStatus | TranslationLangStatus },
): Array<SegmentRow & { document_path: string; target_text: string | null; translation_status: string | null }> {
  const params: unknown[] = [];
  let sql = `
    SELECT s.*, d.path AS document_path,
      (
        SELECT t.target_text FROM translations t
        WHERE t.segment_id = s.id
  `;
  if (opts.lang) {
    sql += ` AND t.lang = ?`;
    params.push(opts.lang);
  }
  sql += ` ORDER BY t.updated_at DESC LIMIT 1) AS target_text,
      (
        SELECT t.status FROM translations t
        WHERE t.segment_id = s.id
  `;
  if (opts.lang) {
    sql += ` AND t.lang = ?`;
    params.push(opts.lang);
  }
  sql += ` ORDER BY t.updated_at DESC LIMIT 1) AS translation_status
    FROM segments s
    JOIN documents d ON d.id = s.document_id
    WHERE 1=1`;

  if (opts.lang && opts.status) {
    // Prefer per-lang translation status when reviewing a language.
    sql += ` AND EXISTS (
      SELECT 1 FROM translations t
      WHERE t.segment_id = s.id AND t.lang = ? AND t.status = ?
    )`;
    params.push(opts.lang, opts.status);
  } else if (opts.status) {
    sql += ` AND s.status = ?`;
    params.push(opts.status);
  }

  sql += ` ORDER BY d.path, s.order_index`;
  return db.prepare(sql).all(...params) as Array<
    SegmentRow & {
      document_path: string;
      target_text: string | null;
      translation_status: string | null;
    }
  >;
}

export function getStatusCounts(
  db: Database.Database,
  lang?: string,
): Array<{
  path: string;
  pending: number;
  translated: number;
  stale: number;
  approved: number;
  total: number;
  lang?: string;
}> {
  const docs = db.prepare(`SELECT id, path FROM documents ORDER BY path`).all() as Array<{
    id: string;
    path: string;
  }>;

  return docs.map((doc) => {
    const totalRow = db
      .prepare(`SELECT COUNT(*) AS n FROM segments WHERE document_id = ?`)
      .get(doc.id) as { n: number };
    const total = totalRow.n;

    if (!lang) {
      // Approvals live on translations, not segments. Roll up per segment across
      // all langs so `status` without --lang shows real approved counts.
      const segments = db
        .prepare(`SELECT id, status FROM segments WHERE document_id = ?`)
        .all(doc.id) as Array<{ id: string; status: SegmentStatus }>;
      const translationRows = db
        .prepare(
          `SELECT t.segment_id AS segment_id, t.status AS status
           FROM translations t
           JOIN segments s ON s.id = t.segment_id
           WHERE s.document_id = ?`,
        )
        .all(doc.id) as Array<{ segment_id: string; status: TranslationLangStatus }>;
      const bySegment = new Map<string, TranslationLangStatus[]>();
      for (const row of translationRows) {
        const list = bySegment.get(row.segment_id) ?? [];
        list.push(row.status);
        bySegment.set(row.segment_id, list);
      }
      const counts = { pending: 0, translated: 0, stale: 0, approved: 0, total };
      for (const seg of segments) {
        const statuses = bySegment.get(seg.id);
        if (!statuses || statuses.length === 0) {
          if (seg.status === "stale") counts.stale += 1;
          else if (seg.status === "translated" || seg.status === "approved") {
            counts.translated += 1;
          } else {
            counts.pending += 1;
          }
          continue;
        }
        if (statuses.some((s) => s === "stale")) counts.stale += 1;
        else if (statuses.every((s) => s === "approved")) counts.approved += 1;
        else counts.translated += 1;
      }
      return { path: doc.path, ...counts };
    }

    const rows = db
      .prepare(
        `SELECT t.status AS status, COUNT(*) AS n
         FROM translations t
         JOIN segments s ON s.id = t.segment_id
         WHERE s.document_id = ? AND t.lang = ?
         GROUP BY t.status`,
      )
      .all(doc.id, lang) as Array<{ status: TranslationLangStatus; n: number }>;

    const translated = rows.find((r) => r.status === "translated")?.n ?? 0;
    const stale = rows.find((r) => r.status === "stale")?.n ?? 0;
    const approved = rows.find((r) => r.status === "approved")?.n ?? 0;
    const covered = translated + stale + approved;
    const pending = Math.max(0, total - covered);
    return {
      path: doc.path,
      pending,
      translated,
      stale,
      approved,
      total,
      lang,
    };
  });
}

/** Count translated segments that are not yet locally approved (for publish gate). */
export function countUnapprovedTranslations(
  db: Database.Database,
  lang?: string,
): number {
  if (lang) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM translations t
         WHERE t.lang = ? AND (t.approved = 0 OR t.status = 'stale')`,
      )
      .get(lang) as { n: number };
    return row.n;
  }
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM translations t
       WHERE t.approved = 0 OR t.status = 'stale'`,
    )
    .get() as { n: number };
  return row.n;
}

export function countApprovedTranslations(
  db: Database.Database,
  lang?: string,
): number {
  if (lang) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM translations t
         WHERE t.lang = ? AND t.approved = 1`,
      )
      .get(lang) as { n: number };
    return row.n;
  }
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM translations WHERE approved = 1`)
    .get() as { n: number };
  return row.n;
}



function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
