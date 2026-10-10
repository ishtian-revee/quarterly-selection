import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("AC13 README covers required sections", () => {
  const r = readFileSync("README.md", "utf8");
  for (const s of [
    "Prerequisites", "npm install", "npm test", "npm run -s select", "npm run -s verify", "22.12",
    "Auditor", "O(n log n)", "O(n)", "predictable", "Commit-reveal", "randomness beacon",
  ]) expect(r).toContain(s);
});
