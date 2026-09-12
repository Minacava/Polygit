import type Database from "better-sqlite3";
import type {
  DocumentFormat,
  DocumentRow,
  GlossaryRow,
  SegmentRow,
  SegmentStatus,
  TranslationMemoryRow,
  TranslationRow,
  TranslationSource,
} from "./db.js";
import { nowIso } from "./project.js";
import { createId, createSegmentId, normalizeText, type RawSegment } from "./segmenter.js";

export function upsertDocument(
  db: Database.Database,
  relativePath: string,
  format: DocumentFormat,
): DocumentRow {
  const existing = db
    .prepare(`SELECT * FROM documents WHERE path = ?`)
    .get(relativePath) as DocumentRow | undefined;

  const ts = nowIso();
  if (existing) {
    db.prepare(`UPDATE documents SET format = ?, updated_at = ? WHERE id = ?`).run(
      format,
      ts,
      existing.id,
    );
    return { ...existing, format, updated_at: ts };
  }

  const row: DocumentRow = {
    id: createId("doc"),
    path: relativePath,
    format,
    imported_at: ts,
    updated_at: ts,
  };
  db.prepare(
    `INSERT INTO documents (id, path, format, imported_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(row.id, row.path, row.format, row.imported_at, row.updated_at);
  return row;
}

/**
 * Upsert segments for a document. IDs are stable hashes of path + order + content.
 * Segments that disappear from the source file are removed.
 */
export function replaceDocumentSegments(
  db: Database.Database,
  document: DocumentRow,
  rawSegments: RawSegment[],
): { inserted: number; unchanged: number; removed: number } {
  const existing = db
    .prepare(`SELECT * FROM segments WHERE document_id = ?`)
    .all(document.id) as SegmentRow[];
  const existingById = new Map(existing.map((s) => [s.id, s]));

  const nextIds = new Set<string>();
  let inserted = 0;
  let unchanged = 0;
  const ts = nowIso();

  const run = db.transaction(() => {
    for (const raw of rawSegments) {
      const id = createSegmentId(document.path, raw.orderIndex, raw.sourceText);
      nextIds.add(id);
      const prev = existingById.get(id);
      if (prev && normalizeText(prev.source_text) === normalizeText(raw.sourceText)) {
        db.prepare(`UPDATE segments SET order_index = ?, updated_at = ? WHERE id = ?`).run(
          raw.orderIndex,
          ts,
          id,
        );
        unchanged += 1;
        continue;
      }

      if (prev) {
        db.prepare(
          `UPDATE segments SET order_index = ?, source_text = ?, status = 'pending', updated_at = ? WHERE id = ?`,
        ).run(raw.orderIndex, raw.sourceText, ts, id);
        inserted += 1;
      } else {
        db.prepare(
          `INSERT INTO segments (id, document_id, order_index, source_text, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
        ).run(id, document.id, raw.orderIndex, raw.sourceText, ts, ts);
        inserted += 1;
      }
    }

    let removed = 0;
    for (const old of existing) {
      if (!nextIds.has(old.id)) {
        db.prepare(`DELETE FROM segments WHERE id = ?`).run(old.id);
        removed += 1;
      }
    }
    return removed;
  });

  const removed = run();
  return { inserted, unchanged, removed };
}

export function listSegmentsForTranslate(
  db: Database.Database,
  opts: { documentPath?: string; statuses?: SegmentStatus[]; segmentIds?: string[] },
): Array<SegmentRow & { document_path: string; document_format: DocumentFormat }> {
  const statuses = opts.statuses ?? ["pending", "stale"];
  const placeholders = statuses.map(() => "?").join(", ");
  const params: unknown[] = [...statuses];

  let sql = `
    SELECT s.*, d.path AS document_path, d.format AS document_format
    FROM segments s
    JOIN documents d ON d.id = s.document_id
    WHERE s.status IN (${placeholders})
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
): void {
  const ts = nowIso();
  const existing = db
    .prepare(`SELECT id FROM translations WHERE segment_id = ? AND lang = ?`)
    .get(segmentId, lang) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE translations SET target_text = ?, source = ?, approved = ?, updated_at = ? WHERE id = ?`,
    ).run(targetText, source, approved ? 1 : 0, ts, existing.id);
  } else {
    db.prepare(
      `INSERT INTO translations (id, segment_id, lang, target_text, source, approved, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(createId("tr"), segmentId, lang, targetText, source, approved ? 1 : 0, ts);
  }

  const status: SegmentStatus = approved ? "approved" : "translated";
  db.prepare(`UPDATE segments SET status = ?, updated_at = ? WHERE id = ?`).run(
    status,
    ts,
    segmentId,
  );
}

export function upsertTranslationMemory(
  db: Database.Database,
  sourceText: string,
  targetText: string,
  lang: string,
): void {
  const normalized = normalizeText(sourceText);
  const existing = db
    .prepare(`SELECT * FROM translation_memory WHERE lang = ?`)
    .all(lang) as TranslationMemoryRow[];

  const hit = existing.find((e) => normalizeText(e.source_text) === normalized);
  const ts = nowIso();
  if (hit) {
    db.prepare(
      `UPDATE translation_memory
       SET target_text = ?, usage_count = usage_count + 1, updated_at = ?
       WHERE id = ?`,
    ).run(targetText, ts, hit.id);
  } else {
    db.prepare(
      `INSERT INTO translation_memory (id, source_text, target_text, lang, usage_count, updated_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
    ).run(createId("tm"), sourceText, targetText, lang, ts);
  }
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
      const needle = term.source_term.toLocaleLowerCase();
      for (const segment of segments) {
        if (segment.source_text.toLocaleLowerCase().includes(needle)) {
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
  const update = db.prepare(
    `UPDATE segments SET status = 'stale', updated_at = ? WHERE id = ?`,
  );
  for (const segmentId of segmentIds) update.run(ts, segmentId);
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
  opts: { lang?: string; status?: SegmentStatus },
): Array<SegmentRow & { document_path: string; target_text: string | null }> {
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
  sql += ` ORDER BY t.updated_at DESC LIMIT 1) AS target_text
    FROM segments s
    JOIN documents d ON d.id = s.document_id
    WHERE 1=1`;
  if (opts.status) {
    sql += ` AND s.status = ?`;
    params.push(opts.status);
  }
  sql += ` ORDER BY d.path, s.order_index`;
  return db.prepare(sql).all(...params) as Array<
    SegmentRow & { document_path: string; target_text: string | null }
  >;
}

export function getStatusCounts(db: Database.Database): Array<{
  path: string;
  pending: number;
  translated: number;
  stale: number;
  approved: number;
  total: number;
}> {
  const docs = db.prepare(`SELECT id, path FROM documents ORDER BY path`).all() as Array<{
    id: string;
    path: string;
  }>;

  return docs.map((doc) => {
    const rows = db
      .prepare(
        `SELECT status, COUNT(*) AS n FROM segments WHERE document_id = ? GROUP BY status`,
      )
      .all(doc.id) as Array<{ status: SegmentStatus; n: number }>;
    const counts = { pending: 0, translated: 0, stale: 0, approved: 0, total: 0 };
    for (const row of rows) {
      counts[row.status] = row.n;
      counts.total += row.n;
    }
    return { path: doc.path, ...counts };
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
        `SELECT COUNT(*) AS n FROM segments s
         JOIN translations t ON t.segment_id = s.id
         WHERE t.lang = ? AND s.status = 'translated' AND t.approved = 0`,
      )
      .get(lang) as { n: number };
    return row.n;
  }
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM segments s
       WHERE s.status = 'translated'`,
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

