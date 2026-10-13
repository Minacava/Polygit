import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runClone } from "../../dist/commands/clone.js";

describe("clone URL validation", () => {
  it("rejects ext:: before invoking git", async () => {
    await assert.rejects(() => runClone("ext::sh -c evil"), /ext::/);
  });

  it("rejects file: before invoking git", async () => {
    await assert.rejects(() => runClone("file:///tmp/repo.git"), /file:/i);
  });

  it("rejects leading-dash URLs", async () => {
    await assert.rejects(
      () => runClone("--upload-pack=evil"),
      /Rejected clone URL|Unrecognized|Unsupported/i,
    );
  });
});
