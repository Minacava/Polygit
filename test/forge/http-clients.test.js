import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGitHubClient } from "../../dist/forge/github.js";
import { createGitLabClient } from "../../dist/forge/gitlab.js";

describe("forge HTTP clients", () => {
  it("opens a GitHub pull request via fetch", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 201,
        async json() {
          return {
            number: 42,
            html_url: "https://github.com/acme/docs/pull/42",
          };
        },
      };
    };

    const client = createGitHubClient("gh-test-token", fetchImpl);
    const result = await client.createMergeRequest(
      {
        kind: "github",
        host: "api.github.com",
        owner: "acme",
        name: "docs",
        fullPath: "acme/docs",
        webBase: "https://github.com",
      },
      {
        sourceBranch: "polygit/translate-fr",
        targetBranch: "main",
        title: "translate: fr",
        body: "hello",
        draft: true,
      },
    );

    assert.equal(result.number, 42);
    assert.match(result.url, /pull\/42/);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /api\.github\.com\/repos\/acme\/docs\/pulls/);
    assert.equal(calls[0].init.method, "POST");
    assert.match(String(calls[0].init.headers.authorization), /Bearer gh-test-token/);
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.head, "polygit/translate-fr");
    assert.equal(body.base, "main");
    assert.equal(body.draft, true);
  });

  it("opens a GitLab merge request via fetch", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 201,
        async json() {
          return {
            iid: 7,
            web_url: "https://gitlab.com/acme/docs/-/merge_requests/7",
          };
        },
      };
    };

    const client = createGitLabClient("gl-test-token", fetchImpl);
    const result = await client.createMergeRequest(
      {
        kind: "gitlab",
        host: "gitlab.com",
        owner: "acme",
        name: "docs",
        fullPath: "acme/docs",
        webBase: "https://gitlab.com",
      },
      {
        sourceBranch: "polygit/translate-es",
        targetBranch: "main",
        title: "translate: es",
        body: "hola",
        draft: false,
      },
    );

    assert.equal(result.number, 7);
    assert.match(result.url, /merge_requests\/7/);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /gitlab\.com\/api\/v4\/projects\/acme%2Fdocs\/merge_requests/);
    assert.equal(calls[0].init.headers["private-token"], "gl-test-token");
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.source_branch, "polygit/translate-es");
    assert.equal(body.target_branch, "main");
  });
});
