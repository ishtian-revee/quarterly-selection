import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

const run = (...args: string[]) =>
  spawnSync("npm", ["run", "-s", ...args], { encoding: "utf8" });

it("AC12 select twice is stable, verify VALID then INVALID after tamper", () => {
  const dir = mkdtempSync(join(tmpdir(), "qs-"));
  const vehicles = join(dir, "v.txt");
  const store = join(dir, "store.json");
  const recFile = join(dir, "rec.json");
  writeFileSync(vehicles, Array.from({ length: 40 }, (_, i) => `v${i}`).join("\n") + "\n");
  const args = ["select", "--", "--company", "c1", "--quarter", "2026-Q4", "--percent", "25", "--vehicles", vehicles, "--store", store];

  const a = run(...args);
  const b = run(...args);
  expect(a.status).toBe(0);
  expect(JSON.parse(b.stdout)).toEqual(JSON.parse(a.stdout));
  expect(JSON.parse(a.stdout).selectedVehicleIds).toHaveLength(10);

  writeFileSync(recFile, a.stdout);
  const ok = run("verify", "--", "--record", recFile);
  expect(ok.status).toBe(0);
  expect(ok.stdout.trim()).toBe("VALID");

  const rec = JSON.parse(readFileSync(recFile, "utf8"));
  rec.selectedVehicleIds[0] = "tampered";
  writeFileSync(recFile, JSON.stringify(rec));
  const bad = run("verify", "--", "--record", recFile);
  expect(bad.status).toBe(1);
  expect(bad.stdout.trim()).toBe("INVALID");
});
