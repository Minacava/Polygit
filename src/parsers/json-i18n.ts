import type { RawSegment } from "../core/segmenter.js";
import type { ParsedDocument, Parser } from "./types.js";

interface JsonLeaf {
  path: Array<string | number>;
  orderIndex: number;
  sourceText: string;
}

interface JsonSkeleton {
  root: unknown;
  leaves: JsonLeaf[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * JSON i18n parser: every string leaf becomes a segment; structure is preserved.
 */
export const jsonI18nParser: Parser = {
  format: "json-i18n",

  parse(content: string): ParsedDocument {
    let root: unknown;
    try {
      root = JSON.parse(content) as unknown;
    } catch {
      throw new Error("Invalid JSON: could not parse i18n file.");
    }

    const leaves: JsonLeaf[] = [];
    const segments: RawSegment[] = [];
    let orderIndex = 0;

    const walk = (node: unknown, pathParts: Array<string | number>) => {
      if (typeof node === "string") {
        leaves.push({ path: pathParts, orderIndex, sourceText: node });
        segments.push({ orderIndex, sourceText: node });
        orderIndex += 1;
        return;
      }
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, [...pathParts, index]));
        return;
      }
      if (isPlainObject(node)) {
        for (const [key, value] of Object.entries(node)) {
          walk(value, [...pathParts, key]);
        }
      }
    };

    walk(root, []);
    const skeleton: JsonSkeleton = { root, leaves };
    return { format: "json-i18n", segments, skeleton };
  },

  serialize(skeleton: unknown, translations: Map<number, string>): string {
    const { root, leaves } = skeleton as JsonSkeleton;
    const clone = structuredClone(root);

    for (const leaf of leaves) {
      const text = translations.get(leaf.orderIndex) ?? leaf.sourceText;
      setAtPath(clone, leaf.path, text);
    }

    return `${JSON.stringify(clone, null, 2)}\n`;
  },
};

function setAtPath(root: unknown, pathParts: Array<string | number>, value: string): void {
  if (pathParts.length === 0) return;
  let current: unknown = root;
  for (let i = 0; i < pathParts.length - 1; i++) {
    const key = pathParts[i]!;
    if (Array.isArray(current)) {
      current = current[key as number];
    } else if (isPlainObject(current)) {
      current = current[String(key)];
    } else {
      return;
    }
  }
  const last = pathParts[pathParts.length - 1]!;
  if (Array.isArray(current)) {
    current[last as number] = value;
  } else if (isPlainObject(current)) {
    current[String(last)] = value;
  }
}
