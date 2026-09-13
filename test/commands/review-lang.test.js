import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runInit } from "../../dist/commands/init.js";
import { runReview } from "../../dist/commands/review.js";

describe("review command", () => {
  it("requires --lang", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-review-"));
    const prev = process.cwd();
    process.chdir(root);
    try {
      await runInit();
      await assert.rejects(() => runReview({}), /Language is required/i);
    } finally {
      process.chdir(prev);
    }
  });
});
