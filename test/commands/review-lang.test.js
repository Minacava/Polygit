import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runInit } from "../../dist/commands/init.js";
import { REVIEW_KEY_TABLE, runReview } from "../../dist/commands/review.js";

describe("review command", () => {
  it("documents a/e/s/q keys in REVIEW_KEY_TABLE", () => {
    assert.match(REVIEW_KEY_TABLE, /\ba\b.*approve/i);
    assert.match(REVIEW_KEY_TABLE, /\be\b.*edit/i);
    assert.match(REVIEW_KEY_TABLE, /\bs\b.*skip/i);
    assert.match(REVIEW_KEY_TABLE, /\bq\b.*quit/i);
  });

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
