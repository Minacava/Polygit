import fs from "node:fs";
import path from "node:path";
import { assertLangCode } from "../core/lang.js";
import {
  openProjectDb,
  readConfig,
  requireProjectRoot,
  resolveInsideProject,
} from "../core/project.js";
import { getTmEntries } from "../core/repository.js";
import { escapeXml } from "../core/xml.js";

export interface ExportTmxOptions {
  lang: string;
  /** Relative or absolute output path (default: `tm-<lang>.tmx` in project root). */
  out?: string;
}

/**
 * Export translation memory entries for one language as TMX 1.4b.
 */
export function runExportTmx(options: ExportTmxOptions): { outPath: string; units: number } {
  assertLangCode(options.lang);
  const projectRoot = requireProjectRoot();
  const config = readConfig(projectRoot);
  const sourceLang = config.sourceLang || "en";
  const outRel = options.out ?? `tm-${options.lang}.tmx`;
  const absOut = path.isAbsolute(outRel)
    ? outRel
    : resolveInsideProject(projectRoot, outRel);

  const db = openProjectDb(projectRoot);
  try {
    const entries = getTmEntries(db, options.lang);
    const body = entries
      .map((e) => {
        return [
          `    <tu>`,
          `      <tuv xml:lang="${escapeXml(sourceLang)}"><seg>${escapeXml(e.source_text)}</seg></tuv>`,
          `      <tuv xml:lang="${escapeXml(options.lang)}"><seg>${escapeXml(e.target_text)}</seg></tuv>`,
          `    </tu>`,
        ].join("\n");
      })
      .join("\n");

    const xml = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<tmx version="1.4">`,
      `  <header`,
      `    creationtool="polygit"`,
      `    creationtoolversion="1"`,
      `    segtype="sentence"`,
      `    o-tmf="polygit"`,
      `    adminlang="${escapeXml(sourceLang)}"`,
      `    srclang="${escapeXml(sourceLang)}"`,
      `    datatype="plaintext"`,
      `  />`,
      `  <body>`,
      body,
      `  </body>`,
      `</tmx>`,
      ``,
    ].join("\n");

    fs.mkdirSync(path.dirname(absOut), { recursive: true });
    fs.writeFileSync(absOut, xml, "utf8");
    const display = path.isAbsolute(outRel)
      ? absOut
      : path.relative(projectRoot, absOut).split(path.sep).join("/");
    console.log(`Exported ${entries.length} TM unit(s) to ${display}`);
    return { outPath: absOut, units: entries.length };
  } finally {
    db.close();
  }
}
