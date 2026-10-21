import type { RawSegment } from "../core/segmenter.js";
import { escapeXml } from "../core/xml.js";
import type { ParsedDocument, Parser } from "./types.js";

interface XliffUnit {
  id: string;
  source: string;
  target: string;
  orderIndex: number;
}

interface XliffSkeleton {
  prefix: string;
  units: XliffUnit[];
  suffix: string;
  raw: string;
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Minimal XLIFF 1.2 parser for <trans-unit> source/target pairs.
 */
export const xliffParser: Parser = {
  format: "xliff",

  parse(content: string): ParsedDocument {
    const normalized = content.replace(/\r\n/g, "\n");
    const units: XliffUnit[] = [];
    const segments: RawSegment[] = [];
    let orderIndex = 0;

    const unitRe =
      /<trans-unit\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/trans-unit>/gi;
    let match: RegExpExecArray | null;
    while ((match = unitRe.exec(normalized)) !== null) {
      const id = match[1] ?? "";
      const body = match[2] ?? "";
      const source = decodeXml(
        body.match(/<source\b[^>]*>([\s\S]*?)<\/source>/i)?.[1] ?? "",
      );
      const target = decodeXml(
        body.match(/<target\b[^>]*>([\s\S]*?)<\/target>/i)?.[1] ?? "",
      );
      units.push({ id, source, target, orderIndex });
      if (source) {
        segments.push({ orderIndex, sourceText: source });
        orderIndex += 1;
      }
    }

    return {
      format: "xliff",
      segments,
      skeleton: {
        prefix: "",
        units,
        suffix: "",
        raw: normalized,
      } satisfies XliffSkeleton,
    };
  },

  serialize(skeleton: unknown, translations: Map<number, string>): string {
    const { raw, units } = skeleton as XliffSkeleton;
    let out = raw;
    let seg = 0;
    for (const unit of units) {
      const translated = unit.source
        ? (translations.get(seg) ?? unit.target ?? unit.source)
        : unit.target;
      if (unit.source) seg += 1;
      const unitRe = new RegExp(
        `<trans-unit\\b[^>]*\\bid="${unit.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>[\\s\\S]*?<\\/trans-unit>`,
        "i",
      );
      out = out.replace(unitRe, (block) => {
        if (/<target\b/i.test(block)) {
          return block.replace(
            /<target\b[^>]*>[\s\S]*?<\/target>/i,
            `<target>${escapeXml(translated)}</target>`,
          );
        }
        return block.replace(
          /<\/source>/i,
          `</source>\n        <target>${escapeXml(translated)}</target>`,
        );
      });
    }
    return out.endsWith("\n") ? out : `${out}\n`;
  },
};
