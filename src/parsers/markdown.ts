import { segmentProse, type RawSegment } from "../core/segmenter.js";
import type { ParsedDocument, Parser } from "./types.js";

interface MarkdownBlock {
  type: "segment" | "raw";
  /** Present when type === "segment". */
  orderIndex?: number;
  text: string;
}

interface MarkdownSkeleton {
  blocks: MarkdownBlock[];
}

/**
 * Markdown parser: fenced code and HTML comments stay raw;
 * headings and prose paragraphs become translatable segments.
 */
export const markdownParser: Parser = {
  format: "markdown",

  parse(content: string): ParsedDocument {
    const normalized = content.replace(/\r\n/g, "\n");
    const blocks: MarkdownBlock[] = [];
    const segments: RawSegment[] = [];
    let orderIndex = 0;

    const lines = normalized.split("\n");
    let i = 0;
    let proseBuffer: string[] = [];

    const flushProse = () => {
      if (proseBuffer.length === 0) return;
      const chunk = proseBuffer.join("\n").trimEnd();
      proseBuffer = [];
      if (!chunk.trim()) {
        blocks.push({ type: "raw", text: chunk + "\n\n" });
        return;
      }

      // Headings: one segment for the whole heading line/block.
      if (/^#{1,6}\s+\S/.test(chunk.trim())) {
        const text = chunk.trim();
        segments.push({ orderIndex, sourceText: text });
        blocks.push({ type: "segment", orderIndex, text });
        orderIndex += 1;
        blocks.push({ type: "raw", text: "\n\n" });
        return;
      }

      const parts = segmentProse(chunk);
      if (parts.length === 0) {
        blocks.push({ type: "raw", text: chunk + "\n\n" });
        return;
      }

      for (let p = 0; p < parts.length; p++) {
        const part = parts[p]!;
        const mapped: RawSegment = {
          orderIndex,
          sourceText: part.sourceText,
        };
        segments.push(mapped);
        blocks.push({ type: "segment", orderIndex, text: part.sourceText });
        orderIndex += 1;
        if (p < parts.length - 1) {
          blocks.push({ type: "raw", text: " " });
        }
      }
      blocks.push({ type: "raw", text: "\n\n" });
    };

    while (i < lines.length) {
      const line = lines[i] ?? "";

      // Fenced code block
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
        blocks.push({ type: "raw", text: fence.join("\n") + "\n\n" });
        continue;
      }

      // Blank line ends a prose block
      if (line.trim() === "") {
        flushProse();
        i += 1;
        continue;
      }

      proseBuffer.push(line);
      i += 1;
    }
    flushProse();

    // Trim trailing extra blank separators for cleaner files
    const skeleton: MarkdownSkeleton = { blocks };
    return { format: "markdown", segments, skeleton };
  },

  serialize(skeleton: unknown, translations: Map<number, string>): string {
    const { blocks } = skeleton as MarkdownSkeleton;
    let out = "";
    for (const block of blocks) {
      if (block.type === "raw") {
        out += block.text;
      } else {
        const idx = block.orderIndex ?? -1;
        out += translations.get(idx) ?? block.text;
      }
    }
    return out.replace(/\n{3,}/g, "\n\n").replace(/\s+$/u, "\n");
  },
};
