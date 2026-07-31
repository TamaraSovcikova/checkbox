// @vitest-environment happy-dom
//
// The deploy detector. Its whole job is comparing the hashed entry bundle this
// tab is running against the one the server would serve now, so the cases that
// matter are: a real deploy, no deploy, and every flavour of "cannot tell",
// which must NEVER be reported as stale (a false positive reloads her page).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runningBundle, deployedBundle, isStale } from "../lib/update";

// The server answers /api/version with the deployed entry bundle.
const version = (asset: string | null) => JSON.stringify({ bundle: asset });

function loadTabWith(asset: string | null) {
  document.head.innerHTML = "";
  if (asset) {
    const s = document.createElement("script");
    s.setAttribute("src", `/${asset}`);
    document.head.appendChild(s);
  }
}

const serve = (body: string, ok = true) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (_url: string, _init?: RequestInit) =>
        ({ ok, json: async () => JSON.parse(body) }) as unknown as Response
    )
  );

beforeEach(() => loadTabWith("assets/index-AAAA1111.js"));
afterEach(() => vi.unstubAllGlobals());

describe("runningBundle", () => {
  it("finds the hashed entry script", () => {
    expect(runningBundle()).toBe("assets/index-AAAA1111.js");
  });

  it("is null when there is no hashed bundle (the dev server)", () => {
    loadTabWith(null);
    expect(runningBundle()).toBeNull();
  });

  it("ignores unhashed scripts like registerSW.js", () => {
    loadTabWith(null);
    const sw = document.createElement("script");
    sw.setAttribute("src", "/registerSW.js");
    document.head.appendChild(sw);
    expect(runningBundle()).toBeNull();
  });
});

describe("deployedBundle", () => {
  it("reads the entry the server reports", async () => {
    serve(version("assets/index-BBBB2222.js"));
    expect(await deployedBundle()).toBe("assets/index-BBBB2222.js");
  });

  it("asks /api/version, which the service worker cannot answer from cache", async () => {
    const f = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        ({ ok: true, json: async () => ({ bundle: "assets/index-X.js" }) }) as unknown as Response
    );
    vi.stubGlobal("fetch", f);
    await deployedBundle();
    expect(String(f.mock.calls[0][0])).toContain("/api/version");
  });

  it("returns null when the request fails or errors", async () => {
    serve(version(null), false);
    expect(await deployedBundle()).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      })
    );
    expect(await deployedBundle()).toBeNull();
  });

  it("returns null when the answer carries no usable bundle", async () => {
    serve(version(null));
    expect(await deployedBundle()).toBeNull();
    serve(JSON.stringify({ bundle: "not-a-bundle" }));
    expect(await deployedBundle()).toBeNull();
  });

  it("bypasses every cache: that is the entire point of the check", async () => {
    const f = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        ({ ok: true, json: async () => ({ bundle: "assets/index-X.js" }) }) as unknown as Response
    );
    vi.stubGlobal("fetch", f);
    await deployedBundle();
    expect(f.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });
});

describe("isStale", () => {
  it("reports the new bundle when the server has moved on", async () => {
    serve(version("assets/index-BBBB2222.js"));
    expect(await isStale()).toBe("assets/index-BBBB2222.js");
  });

  it("is null when the server serves what this tab is running", async () => {
    serve(version("assets/index-AAAA1111.js"));
    expect(await isStale()).toBeNull();
  });

  it("is null when the check failed: unknown is never stale", async () => {
    serve(version(null), false);
    expect(await isStale()).toBeNull();
  });

  it("is null in dev, where this tab has no hashed bundle to compare", async () => {
    loadTabWith(null);
    serve(version("assets/index-BBBB2222.js"));
    expect(await isStale()).toBeNull();
  });
});
