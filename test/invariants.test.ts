// Release-blocking invariant: Checkbox NEVER sends mail (design SC4 / Premise 2).
//
// Phase B will hold gmail.modify, which is itself send-capable, so "we never
// request gmail.send" proves nothing. The only real guarantee is that no send
// call exists anywhere in the source. This test is that guarantee — it fails the
// build if one ever appears. She merges her own PRs and there is no CI, so a
// test is the only gate that actually runs.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "src");

// Gmail send endpoints: messages.send, drafts.send, and the REST path forms.
const FORBIDDEN = [
  /\bmessages\.send\b/,
  /\bdrafts\.send\b/,
  /\bgmail\.send\b/,
  /messages\/send/,
  /drafts\/send/,
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory()
      ? walk(p)
      : /\.(ts|tsx)$/.test(name)
      ? [p]
      : [];
  });
}

describe("Checkbox never sends mail", () => {
  it("no Gmail send call exists anywhere in src/", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const re of FORBIDDEN) {
        if (re.test(text)) offenders.push(`${file} matched ${re}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
