import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCommitMessageMessages,
  defaultCommitMessage,
  sanitizeCommitMessage,
  truncateDiff,
  generateCommitMessage,
  MAX_DIFF_CHARS,
} from "../../dist/commands/commit-message.js";

describe("commit-message helpers", () => {
  it("builds a dated default message", () => {
    assert.equal(
      defaultCommitMessage(new Date("2026-10-21T12:00:00Z")),
      "translate: update content (2026-10-21)",
    );
  });

  it("truncates long diffs", () => {
    const long = "x".repeat(MAX_DIFF_CHARS + 50);
    const out = truncateDiff(long);
    assert.ok(out.length < long.length);
    assert.match(out, /truncated/);
  });

  it("sanitizes model output to one line", () => {
    assert.equal(
      sanitizeCommitMessage('```\ntranslate(fr): add readme\n```\n'),
      "translate(fr): add readme",
    );
    assert.equal(
      sanitizeCommitMessage('Message: translate: update onboarding'),
      "translate: update onboarding",
    );
  });

  it("builds system+user prompt messages", () => {
    const messages = buildCommitMessageMessages("diff --git a/outputs/fr/a.md");
    assert.equal(messages[0].role, "system");
    assert.equal(messages[1].role, "user");
    assert.match(messages[1].content, /outputs\/fr\/a\.md/);
  });

  it("generateCommitMessage uses provider.complete", async () => {
    const provider = {
      name: "ollama",
      translateSegment: async () => "",
      complete: async () => "translate(fr): add French readme",
    };
    const msg = await generateCommitMessage({
      diff: "+Bonjour\n",
      projectRoot: process.cwd(),
      providerInstance: provider,
      config: {
        sourceLang: "en",
        targetLangs: ["fr"],
        defaultProvider: "ollama",
        contentRoots: ["sources"],
        outputMode: "mirror",
        outputRoot: "outputs",
        models: {},
        forgeHosts: [],
      },
    });
    assert.equal(msg, "translate(fr): add French readme");
  });
});
