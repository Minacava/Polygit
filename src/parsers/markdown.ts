import { segmentProse, type RawSegment } from "../core/segmenter.js";
import type { ParsedDocument, Parser } from "./types.js";

interface MarkdownBlock {
  type: "segment" | "raw";
  orderIndex?: number;
  text: string;
}

interface MarkdownSkeleton {
  blocks: MarkdownBlock[];
}

const LIST_ITEM = /^(\s*(?:[-*+]|\d+\.)\s+)(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;

/**
 * Markdown parser:
 * - YAML front matter stays raw
 * - fenced code stays raw
 * - list items and table cells become individual segments
 * - inline code, links, and images are protected while splitting prose
 */
export const markdownParser: Parser = {
  format: "markdown",

  parse(content: string): ParsedDocument {
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
    // A terminating newline makes split() yield a final ""; that is EOF, not a blank line.
    if (normalized.endsWith("\n") && lines[lines.length - 1] === "") {
      lines.pop();
    }
    let i = 0;

    const warnings: string[] = [];
    if ((lines[0] ?? "").trim() === "---") {
      const fm: string[] = [lines[0] ?? ""];
      i = 1;
      let closed = false;
      while (i < lines.length) {
        fm.push(lines[i] ?? "");
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
        // Reset: treat the whole file as body so content is still segmentable.
        blocks.length = 0;
        i = 0;
      } else {
        pushRaw(fm.join("\n") + "\n");
      }
    }

    let proseBuffer: string[] = [];

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
          pushSegment(m[2]!);
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

      if (line.trimStart().startsWith("```")) {
        flushProse();
        const fence = [line];
        i += 1;
        while (i < lines.length) {
          fence.push(lines[i] ?? "");
          if ((lines[i] ?? "").trimStart().startsWith("```")) {
            i += 1;
            break;
          }
          i += 1;
        }
        pushRaw(`${fence.join("\n")}\n`);
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
        continue;
      }

      const listMatch = line.match(LIST_ITEM);
      if (listMatch) {
        flushProse();
        pushRaw(listMatch[1]!);
        const body = listMatch[2] ?? "";
        if (body.trim()) pushSegment(body);
        else pushRaw(body);
        i += 1;
        while (i < lines.length) {
          const cont = lines[i] ?? "";
          if (cont.trim() === "" || LIST_ITEM.test(cont)) break;
          if (/^\s{2,}\S/.test(cont) || /^\t/.test(cont)) {
            pushRaw(`\n${cont}`);
            i += 1;
            continue;
          }
          break;
        }
        pushRaw("\n");
        continue;
      }

      if (line.trim() === "") {
        flushProse();
        pushRaw("\n");
        i += 1;
        continue;
      }

      proseBuffer.push(line);
      i += 1;
    }
    flushProse();

    return {
      format: "markdown",
      segments,
      skeleton: { blocks } satisfies MarkdownSkeleton,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  },

  serialize(skeleton: unknown, translations: Map<number, string>): string {
    const { blocks } = skeleton as MarkdownSkeleton;
    let out = "";
    for (const block of blocks) {
      if (block.type === "raw") out += block.text;
      else out += translations.get(block.orderIndex ?? -1) ?? block.text;
    }
    if (out.length && !out.endsWith("\n")) out += "\n";
    return out;
  },
};

function splitTableCells(row: string): string[] {
  let s = row.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|");
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
