import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  formatOllamaModelSize,
  getOllamaHost,
  isOllamaModelInstalled,
  listOllamaModels,
  ollamaModelMatches,
} from "../../dist/connectors/ollama-models.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ollama-models", () => {
  it("reads OLLAMA_HOST without trailing slash", () => {
    const prev = process.env.OLLAMA_HOST;
    process.env.OLLAMA_HOST = "http://localhost:11434/";
    try {
      assert.equal(getOllamaHost(), "http://localhost:11434");
    } finally {
      if (prev === undefined) delete process.env.OLLAMA_HOST;
      else process.env.OLLAMA_HOST = prev;
    }
  });

  it("lists models from /api/tags", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          models: [
            {
              name: "llama3.2:latest",
              size: 2_000_000_000,
              details: { parameter_size: "3B" },
            },
            { model: "mistral", size: 4_000_000_000 },
          ],
        }),
        { status: 200 },
      );

    const models = await listOllamaModels("http://127.0.0.1:11434");
    assert.equal(models.length, 2);
    assert.equal(models[0]?.name, "llama3.2:latest");
    assert.equal(models[0]?.parameterSize, "3B");
    assert.equal(models[1]?.name, "mistral");
  });

  it("throws a friendly error when Ollama is unreachable", async () => {
    globalThis.fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    await assert.rejects(
      () => listOllamaModels("http://127.0.0.1:11434"),
      /Cannot reach Ollama|ollama serve/i,
    );
  });

  it("formats sizes", () => {
    assert.match(formatOllamaModelSize(2 * 1024 ** 3), /2\.0 GB/);
    assert.match(formatOllamaModelSize(512 * 1024 ** 2), /512 MB/);
    assert.equal(formatOllamaModelSize(undefined), "");
  });

  it("matches untagged requests to tagged installs", () => {
    assert.equal(ollamaModelMatches("llama3.2", "llama3.2:latest"), true);
    assert.equal(ollamaModelMatches("llama3.2:latest", "llama3.2:latest"), true);
    assert.equal(ollamaModelMatches("llama3.2:latest", "llama3.2"), true);
    assert.equal(ollamaModelMatches("llama3.2", "llama3.1:latest"), false);
    assert.equal(ollamaModelMatches("gemma4", "gemma4:26b"), true);
    assert.equal(
      isOllamaModelInstalled("llama3.2", [{ name: "llama3.2:latest" }]),
      true,
    );
    assert.equal(
      isOllamaModelInstalled("mistral", [{ name: "llama3.2:latest" }]),
      false,
    );
  });
});
