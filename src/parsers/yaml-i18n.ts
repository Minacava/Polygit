import type { RawSegment } from "../core/segmenter.js";
import type { ParsedDocument, Parser } from "./types.js";

interface YamlLeaf {
  indent: string;
  key: string;
  quote: '"' | "'" | "";
  value: string;
  orderIndex: number;
}

interface YamlSkeleton {
  lines: Array<{ kind: "raw"; text: string } | { kind: "leaf"; leaf: YamlLeaf }>;
}

function unquote(raw: string): { quote: '"' | "'" | ""; value: string } {
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return { quote: raw[0] as '"' | "'", value: raw.slice(1, -1) };
  }
  return { quote: "", value: raw };
}

function quoteValue(value: string, quote: '"' | "'" | ""): string {
  if (quote === "'") return `'${value.replace(/'/g, "''")}'`;
  if (quote === '"') return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  if (/[:#\n]|^\s|\s$/.test(value)) return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return value;
}

/**
 * Minimal YAML i18n parser for `key: value` maps (nested via indentation).
 * Complex YAML (arrays, multiline blocks) is kept as raw lines.
 */
export const yamlI18nParser: Parser = {
  format: "yaml",

  parse(content: string): ParsedDocument {
    const normalized = content.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    if (normalized.endsWith("\n") && lines[lines.length - 1] === "") lines.pop();

    const skeletonLines: YamlSkeleton["lines"] = [];
    const segments: RawSegment[] = [];
    let orderIndex = 0;

    for (const line of lines) {
      const m = line.match(/^(\s*)([^:#\s][^:]*)\s*:\s*(.*)$/);
      if (!m || m[3] === undefined || m[3].trim() === "" || m[3].trim() === "|" || m[3].trim() === ">") {
        skeletonLines.push({ kind: "raw", text: line });
        continue;
      }
      const indent = m[1] ?? "";
      const key = (m[2] ?? "").trim();
      const { quote, value } = unquote(m[3].trim());
      const leaf: YamlLeaf = { indent, key, quote, value, orderIndex };
      segments.push({ orderIndex, sourceText: value });
      skeletonLines.push({ kind: "leaf", leaf });
      orderIndex += 1;
    }

    return { format: "yaml", segments, skeleton: { lines: skeletonLines } satisfies YamlSkeleton };
  },

  serialize(skeleton: unknown, translations: Map<number, string>): string {
    const { lines } = skeleton as YamlSkeleton;
    const out: string[] = [];
    for (const row of lines) {
      if (row.kind === "raw") {
        out.push(row.text);
        continue;
      }
      const value = translations.get(row.leaf.orderIndex) ?? row.leaf.value;
      out.push(`${row.leaf.indent}${row.leaf.key}: ${quoteValue(value, row.leaf.quote)}`);
    }
    return `${out.join("\n")}\n`;
  },
};
