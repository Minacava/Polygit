import { segmentProse, type RawSegment } from "../core/segmenter.js";
import type { ParsedDocument, Parser } from "./types.js";

interface MarkdownBlock {
  type: "segment" | "raw";
  orderIndex?: number;
  text: string;
}

interface MarkdownSkeleton {
  blocks: MarkdownBlock[];
  eol: "\n" | "\r\n";
}

const LIST_ITEM = /^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;
const FENCE_OPEN = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;
const BLOCKQUOTE = /^(\s{0,3}>\s?)(.*)$/;
const REF_DEF = /^\s{0,3}\[[^\]]+\]:\s*\S/;
const HTML_COMMENT_OPEN = /^\s*<!--/;
const MDX_ESM = /^(import|export)\s/;
const JSX_BLOCK = /^\s*<\/?[A-Z][\w.]*/;
const HEADING_ID = /\s*(\{#[^}]+\})\s*$/;
const DEFAULT_FM_KEYS = new Set(["title", "description", "sidebar_label"]);
const FM_KEY = /^(\s*([\w-]+)\s*:\s*)(["']?)(.*)$/;

/**
 * Markdown parser:
 * - YAML front matter: configurable keys become segments; rest stays raw
 * - fenced code (``` / ~~~), HTML comments, ref defs, MDX/JSX stay raw
 * - list items (incl. `1)`) and table cells become segments
 * - blockquotes: `>` prefix raw, body segmented
 */
export const markdownParser: Parser = {
  format: "markdown",

  parse(content: string): ParsedDocument {
    const eol: "\n" | "\r\n" = content.includes("\r\n") ? "\r\n" : "\n";
    const normalized = content.replace(/\r\n/g, "\n");
    const blocks: MarkdownBlock[] = [];
    const segments: RawSegment[] = [];
    let orderIndex = 0;

    const pushRaw = (text: string) => {
      if (text.length) blocks.push({ type: "raw", text });
    };

    const pushSegment = (text: string) => {
      segments.push({ orderIndex, sourceText: text });
      blocks.push({ type: "segment", orderIndex, text });
      orderIndex += 1;
    };

    const lines = normalized.split("\n");
    if (normalized.endsWith("\n") && lines[lines.length - 1] === "") {
      lines.pop();
    }
    let i = 0;
    const warnings: string[] = [];

    if ((lines[0] ?? "").trim() === "---") {
      const fmLines: string[] = [lines[0] ?? ""];
      i = 1;
      let closed = false;
      while (i < lines.length) {
        fmLines.push(lines[i] ?? "");
        if ((lines[i] ?? "").trim() === "---") {
          i += 1;
          closed = true;
          break;
        }
        i += 1;
      }
      if (!closed) {
        warnings.push(
          "unterminated front matter; treating file as body (no segments from YAML)",
        );
        blocks.length = 0;
        i = 0;
      } else {
        // Opening ---
        pushRaw(`${fmLines[0]}\n`);
        for (let fi = 1; fi < fmLines.length - 1; fi++) {
          const line = fmLines[fi] ?? "";
          const m = line.match(FM_KEY);
          const key = m?.[2];
          if (m && key && DEFAULT_FM_KEYS.has(key)) {
            const prefix = m[1]!;
            const quote = m[3] ?? "";
            let value = m[4] ?? "";
            // Strip matching closing quote if present.
            if (quote && value.endsWith(quote)) {
              value = value.slice(0, -quote.length);
              pushRaw(prefix + quote);
              if (value) pushSegment(value);
              pushRaw(`${quote}\n`);
            } else {
              pushRaw(prefix);
              if (value) pushSegment(value);
              pushRaw("\n");
            }
          } else {
            pushRaw(`${line}\n`);
          }
        }
        // Closing ---
        pushRaw(`${fmLines[fmLines.length - 1]}\n`);
      }
    }

    let proseBuffer: string[] = [];
    let prevBlank = true;

    const flushProse = () => {
      if (proseBuffer.length === 0) return;
      const chunk = proseBuffer.join("\n");
      proseBuffer = [];

      if (!chunk.trim()) {
        pushRaw(chunk + "\n");
        return;
      }

      const trimmed = chunk.trimEnd();

      if (/^#{1,6}\s+\S/.test(trimmed)) {
        const m = trimmed.match(/^(#{1,6}\s+)([\s\S]+)$/);
        if (m) {
          pushRaw(m[1]!);
          let body = m[2]!;
          const idMatch = body.match(HEADING_ID);
          if (idMatch) {
            body = body.slice(0, idMatch.index).trimEnd();
            if (body) pushSegment(body);
            pushRaw(` ${idMatch[1]}`);
          } else {
            pushSegment(body);
          }
        } else {
          pushSegment(trimmed);
        }
        pushRaw("\n");
        return;
      }

      const { text: protectedText, tokens } = extractInline(trimmed);
      const parts = segmentProse(protectedText);
      if (parts.length === 0) {
        pushRaw(`${trimmed}\n`);
        return;
      }
      for (let p = 0; p < parts.length; p++) {
        pushSegment(restoreInline(parts[p]!.sourceText, tokens));
        if (p < parts.length - 1) pushRaw(" ");
      }
      pushRaw("\n");
    };

    while (i < lines.length) {
      const line = lines[i] ?? "";

      const fenceOpen = line.match(FENCE_OPEN);
      if (fenceOpen) {
        flushProse();
        const marker = fenceOpen[2]!;
        const ch = marker[0]!;
        const minLen = marker.length;
        const fence = [line];
        i += 1;
        while (i < lines.length) {
          const cur = lines[i] ?? "";
          fence.push(cur);
          const close = cur.match(FENCE_OPEN);
          if (
            close &&
            close[2]![0] === ch &&
            close[2]!.length >= minLen &&
            !/\S/.test(cur.slice(close[0].length))
          ) {
            i += 1;
            break;
          }
          i += 1;
        }
        pushRaw(`${fence.join("\n")}\n`);
        prevBlank = false;
        continue;
      }

      if (HTML_COMMENT_OPEN.test(line)) {
        flushProse();
        const chunk = [line];
        if (!line.includes("-->")) {
          i += 1;
          while (i < lines.length) {
            chunk.push(lines[i] ?? "");
            if ((lines[i] ?? "").includes("-->")) {
              i += 1;
              break;
            }
            i += 1;
          }
        } else {
          i += 1;
        }
        pushRaw(`${chunk.join("\n")}\n`);
        prevBlank = false;
        continue;
      }

      if (REF_DEF.test(line) || MDX_ESM.test(line.trim()) || JSX_BLOCK.test(line)) {
        flushProse();
        pushRaw(`${line}\n`);
        i += 1;
        prevBlank = false;
        continue;
      }

      const bq = line.match(BLOCKQUOTE);
      if (bq) {
        flushProse();
        pushRaw(bq[1]!);
        const body = bq[2] ?? "";
        if (body.trim()) pushSegment(body);
        else pushRaw(body);
        pushRaw("\n");
        i += 1;
        prevBlank = false;
        continue;
      }

      // Indented code block (4 spaces / tab) after a blank line.
      if (prevBlank && /^( {4}|\t)/.test(line) && !LIST_ITEM.test(line)) {
        flushProse();
        while (i < lines.length && (/^( {4}|\t)/.test(lines[i] ?? "") || (lines[i] ?? "").trim() === "")) {
          pushRaw(`${lines[i]}\n`);
          i += 1;
          if ((lines[i - 1] ?? "").trim() === "") break;
        }
        prevBlank = true;
        continue;
      }

      if (TABLE_ROW.test(line)) {
        flushProse();
        while (i < lines.length && TABLE_ROW.test(lines[i] ?? "")) {
          const row = lines[i]!;
          i += 1;
          if (TABLE_SEP.test(row)) {
            pushRaw(`${row}\n`);
            continue;
          }
          const cells = splitTableCells(row);
          pushRaw("|");
          for (const cell of cells) {
            const leading = cell.match(/^\s*/)?.[0] ?? "";
            const trailingWs = cell.match(/\s*$/)?.[0] ?? "";
            const core = cell.slice(leading.length, cell.length - trailingWs.length);
            pushRaw(leading);
            if (core) pushSegment(core);
            pushRaw(`${trailingWs}|`);
          }
          pushRaw("\n");
        }
        prevBlank = false;
        continue;
      }

      const listMatch = line.match(LIST_ITEM);
      if (listMatch) {
        flushProse();
        pushRaw(listMatch[1]!);
        const bodyLines = [(listMatch[2] ?? "").trimEnd()];
        i += 1;
        while (i < lines.length) {
          const cont = lines[i] ?? "";
          if (cont.trim() === "" || LIST_ITEM.test(cont)) break;
          if (/^\s{2,}\S/.test(cont) || /^\t/.test(cont)) {
            bodyLines.push(cont.trim());
            i += 1;
            continue;
          }
          break;
        }
        const body = bodyLines.filter((b) => b.length > 0).join(" ");
        if (body.trim()) pushSegment(body);
        pushRaw("\n");
        prevBlank = false;
        continue;
      }

      if (line.trim() === "") {
        flushProse();
        pushRaw("\n");
        i += 1;
        prevBlank = true;
        continue;
      }

      proseBuffer.push(line);
      i += 1;
      prevBlank = false;
    }
    flushProse();

    return {
      format: "markdown",
      segments,
      skeleton: { blocks, eol } satisfies MarkdownSkeleton,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  },

  serialize(skeleton: unknown, translations: Map<number, string>): string {
    const { blocks, eol } = skeleton as MarkdownSkeleton;
    let out = "";
    for (const block of blocks) {
      if (block.type === "raw") out += block.text;
      else out += translations.get(block.orderIndex ?? -1) ?? block.text;
    }
    if (out.length && !out.endsWith("\n")) out += "\n";
    if (eol === "\r\n") return out.replace(/\r?\n/g, "\r\n");
    return out;
  },
};

function splitTableCells(row: string): string[] {
  let s = row.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  let inCode = false;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k]!;
    if (ch === "\\" && s[k + 1] === "|") {
      cur += "\\|";
      k += 1;
      continue;
    }
    if (ch === "`") inCode = !inCode;
    if (ch === "|" && !inCode) {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells;
}

function extractInline(text: string): { text: string; tokens: string[] } {
  const tokens: string[] = [];
  const replaced = text
    .replace(/`[^`\n]+`/g, (m) => {
      tokens.push(m);
      return `\uE000${tokens.length - 1}\uE001`;
    })
    .replace(/!\[[^\]]*]\([^)]+\)/g, (m) => {
      tokens.push(m);
      return `\uE000${tokens.length - 1}\uE001`;
    })
    .replace(/\[[^\]]*]\([^)]+\)/g, (m) => {
      tokens.push(m);
      return `\uE000${tokens.length - 1}\uE001`;
    });
  return { text: replaced, tokens };
}

function restoreInline(text: string, tokens: string[]): string {
  return text.replace(/\uE000(\d+)\uE001/g, (_, n) => tokens[Number(n)] ?? "");
}
