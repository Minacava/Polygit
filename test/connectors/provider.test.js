import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTranslationMessages,
  isProviderName,
  parseProviderName,
  redactSecrets,
} from "../../dist/connectors/provider.js";

describe("provider helpers", () => {
  it("builds chat messages with glossary context", () => {
    const messages = buildTranslationMessages("Sign in", "en", "fr", {
      glossary: [{ sourceTerm: "Sign in", targetTerm: "Se connecter", note: "CTA" }],
      documentPath: "sources/ui.md",
    });
    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.role, "system");
    assert.match(messages[0]?.content ?? "", /Se connecter/);
    assert.match(messages[1]?.content ?? "", /sources\/ui\.md/);
    assert.match(messages[1]?.content ?? "", /Sign in/);
  });

  it("recognizes provider names", () => {
    assert.equal(isProviderName("ollama"), true);
    assert.equal(isProviderName("huggingface"), true);
    assert.equal(isProviderName("unknown"), false);
    assert.equal(parseProviderName("ollama"), "ollama");
    assert.equal(parseProviderName("bad", "openai"), "openai");
  });

  it("redacts API keys from error strings", () => {
    const redacted = redactSecrets(
      "failed with sk-ant-abcdefghijklmnopqrstuvwxyz and Bearer tok_1234567890 and glpat-abcdefghij1234567890",
    );
    assert.doesNotMatch(redacted, /sk-ant-abcdefgh/);
    assert.match(redacted, /sk-\*\*\*/);
    assert.match(redacted, /Bearer \*\*\*/);
    assert.match(redacted, /glpat-\*\*\*/);
  });
});
