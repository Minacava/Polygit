import fs from "node:fs";
import {
  isManagedOutputPath,
  toOutputPath,
  type LayoutFields,
} from "../core/layout.js";
import {
  openProjectDb,
  readConfig,
  requireProjectRoot,
  resolveInsideProject,
} from "../core/project.js";
import { deleteDocument } from "../core/repository.js";
import { scanContentDrift } from "./check.js";

export interface PruneOptions {
  /** Also delete on-disk translation outputs for pruned documents. */
  outputs?: boolean;
  dryRun?: boolean;
}

/**
 * Forget documents whose source file was deleted, and optionally remove outputs.
 */
export function runPrune(options: PruneOptions = {}): { pruned: string[] } {
  const root = requireProjectRoot();
  const config = readConfig(root);
  const db = openProjectDb(root);
  try {
    const drift = scanContentDrift(db, root, config);
    if (drift.deletedFiles.length === 0) {
      console.log("prune: nothing to do (no deleted sources)");
      return { pruned: [] };
    }

    if (options.dryRun) {
      console.log(`[dry-run] would prune ${drift.deletedFiles.length} document(s):`);
      for (const p of drift.deletedFiles) console.log(`  ${p}`);
      return { pruned: drift.deletedFiles };
    }

    const layout: LayoutFields = {
      contentRoots: config.contentRoots,
      outputMode: config.outputMode,
      outputRoot: config.outputRoot,
    };

    for (const docPath of drift.deletedFiles) {
      deleteDocument(db, docPath);
      if (options.outputs) {
        for (const lang of config.targetLangs) {
          try {
            const outRel = toOutputPath(docPath, lang, layout);
            if (!isManagedOutputPath(outRel, layout, config.targetLangs)) continue;
            const abs = resolveInsideProject(root, outRel);
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
              fs.unlinkSync(abs);
              console.log(`  removed output ${outRel}`);
            }
          } catch {
            // ignore path resolution errors for missing outputs
          }
        }
      }
      console.log(`pruned ${docPath}`);
    }
    return { pruned: drift.deletedFiles };
  } finally {
    db.close();
  }
}
