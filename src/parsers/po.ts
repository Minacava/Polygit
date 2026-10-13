import type { RawSegment } from "../core/segmenter.js";
import type { ParsedDocument, Parser } from "./types.js";

interface PoUnit {
  comments: string[];
  msgid: string;
  msgstr: string;
}

interface PoSkeleton {
  units: PoUnit[];
  trailing: string;
}

function unescapePo(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function escapePo(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\t/g, "\\t")
    .replace(/\n/g, "\\n");
}

function parsePoString(lines: string[], start: number): { value: string; next: number } {
  let i = start;
  let value = "";
  while (i < lines.length) {
    const m = (lines[i] ?? "").match(/^"(.*)"\s*$/);
    if (!m) break;
    value += unescapePo(m[1] ?? "");
    i += 1;
  }
  return { value, next: i };
}

export const poParser: Parser = {
  format: "po",

  parse(content: string): ParsedDocument {
    const normalized = content.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    const units: PoUnit[] = [];
    const segments: RawSegment[] = [];
    let i = 0;
    let orderIndex = 0;

    while (i < lines.length) {
      if ((lines[i] ?? "").trim() === "") {
        i += 1;
        continue;
      }
      const comments: string[] = [];
      while (i < lines.length && (lines[i] ?? "").startsWith("#")) {
        comments.push(lines[i] ?? "");
        i += 1;
      }
      if (i >= lines.length) break;
      if (!(lines[i] ?? "").startsWith("msgid ")) {
        i += 1;
        continue;
      }
      const firstMsg = (lines[i] ?? "").match(/^msgid\s+"(.*)"\s*$/);
      i += 1;
      let msgid = unescapePo(firstMsg?.[1] ?? "");
      const moreId = parsePoString(lines, i);
      msgid += moreId.value;
      i = moreId.next;

      if (!(lines[i] ?? "").startsWith("msgstr ")) {
        continue;
      }
      const firstStr = (lines[i] ?? "").match(/^msgstr\s+"(.*)"\s*$/);
      i += 1;
      let msgstr = unescapePo(firstStr?.[1] ?? "");
      const moreStr = parsePoString(lines, i);
      msgstr += moreStr.value;
      i = moreStr.next;

      units.push({ comments, msgid, msgstr });
      if (msgid) {
        segments.push({ orderIndex, sourceText: msgid });
        orderIndex += 1;
      }
    }

    return {
      format: "po",
      segments,
      skeleton: { units, trailing: normalized.endsWith("\n") ? "\n" : "" } satisfies PoSkeleton,
    };
  },

  serialize(skeleton: unknown, translations: Map<number, string>): string {
    const { units } = skeleton as PoSkeleton;
    const parts: string[] = [];
    let seg = 0;
    for (const unit of units) {
      if (unit.comments.length) parts.push(unit.comments.join("\n"));
      parts.push(`msgid "${escapePo(unit.msgid)}"`);
      const translated = unit.msgid ? (translations.get(seg) ?? unit.msgstr) : unit.msgstr;
      if (unit.msgid) seg += 1;
      parts.push(`msgstr "${escapePo(translated)}"`);
      parts.push("");
    }
    return parts.join("\n").replace(/\n+$/u, "\n");
  },
};
