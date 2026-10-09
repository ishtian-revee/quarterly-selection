import * as crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  computeSelection,
  ConflictError,
  selectForQuarter,
  type SelectionRecord,
  ValidationError,
  verifySelection,
} from "../src/selection";

vi.mock("node:crypto", async (orig) => {
  const actual = await orig<typeof import("node:crypto")>();
  return { ...actual, randomBytes: vi.fn(actual.randomBytes) };
});

const ids = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`);
const input = (over = {}) => ({
  companyId: "c1",
  quarter: "2026-Q4",
  vehicleIds: ids(20),
  percent: 25,
  seed: "s",
  ...over,
});

describe("AC1 count", () => {
  it("k = ceil(n * percent / 100)", () => {
    expect(computeSelection(ids(20), 25, "s")).toHaveLength(5);
    expect(computeSelection(ids(10), 25, "s")).toHaveLength(3);
    expect(computeSelection(ids(1), 1, "s")).toHaveLength(1);
  });
  it("edges: n=0, percent=0, percent=100", () => {
    expect(computeSelection([], 50, "s")).toEqual([]);
    expect(computeSelection(ids(10), 0, "s")).toEqual([]);
    expect(computeSelection(ids(10), 100, "s")).toEqual(ids(10).sort());
  });
});

describe("AC2 determinism", () => {
  it("same selection whatever the input order", () => {
    const a = computeSelection(ids(50), 30, "seed");
    const b = computeSelection(ids(50).reverse(), 30, "seed");
    expect(a).toEqual(b);
    expect(a).toEqual([...a].sort());
  });
});

describe("AC3 seeds", () => {
  it("different seeds give different selections", () => {
    expect(computeSelection(ids(100), 25, "a")).not.toEqual(computeSelection(ids(100), 25, "b"));
  });
});

describe("AC4 dedupe", () => {
  it("duplicates removed before n", () => {
    expect(computeSelection(["a", "a", "a", "a"], 50, "s")).toHaveLength(1);
    expect(computeSelection(["a", "b", "a", "b"], 100, "s")).toEqual(["a", "b"]);
  });
});

describe("AC5 fairness", () => {
  it("20 vehicles, 25%, 20000 seeds: each count within 5% of 5000", () => {
    const vehicles = ids(20);
    const counts = new Map<string, number>();
    for (let i = 0; i < 20000; i++)
      for (const v of computeSelection(vehicles, 25, `trial-${i}`)) counts.set(v, (counts.get(v) ?? 0) + 1);
    expect(counts.size).toBe(20);
    for (const c of counts.values()) {
      expect(c).toBeGreaterThanOrEqual(4750);
      expect(c).toBeLessThanOrEqual(5250);
    }
  });
});

describe("AC6 idempotency", () => {
  it("returns the same record even if vehicles changed", () => {
    const store = new Map<string, SelectionRecord>();
    const first = selectForQuarter(store, input());
    const again = selectForQuarter(store, input({ vehicleIds: ids(40), seed: "other" }));
    expect(again).toEqual(first);
    expect(store.size).toBe(1);
  });
  it("different percent throws conflict", () => {
    const store = new Map<string, SelectionRecord>();
    selectForQuarter(store, input());
    expect(() => selectForQuarter(store, input({ percent: 50 }))).toThrow(ConflictError);
  });
  it("companies and quarters are independent", () => {
    const store = new Map<string, SelectionRecord>();
    selectForQuarter(store, input());
    selectForQuarter(store, input({ companyId: "c2" }));
    selectForQuarter(store, input({ quarter: "2027-Q1", percent: 50 }));
    expect(store.size).toBe(3);
  });
});

describe("AC7 no memory between quarters", () => {
  it("last quarter's pick stays eligible and can be picked again", () => {
    const store = new Map<string, SelectionRecord>();
    const q3 = selectForQuarter(store, input({ quarter: "2026-Q3", percent: 50, seed: "x3" }));
    const q4 = selectForQuarter(store, input({ quarter: "2026-Q4", percent: 50, seed: "x4" }));
    expect(q4.eligibleVehicleIds).toEqual(ids(20).sort());
    expect(q4.selectedVehicleIds.some((v) => q3.selectedVehicleIds.includes(v))).toBe(true);
  });
});

describe("AC8 verify", () => {
  const genuine = () => selectForQuarter(new Map(), input());
  it("true for genuine record", () => expect(verifySelection(genuine())).toBe(true));
  it("false when tampered", () => {
    const r = genuine();
    expect(verifySelection({ ...r, seed: "x" })).toBe(false);
    expect(verifySelection({ ...r, percent: 60 })).toBe(false);
    expect(verifySelection({ ...r, eligibleVehicleIds: r.eligibleVehicleIds.filter((v) => v !== r.selectedVehicleIds[0]) })).toBe(false);
    expect(verifySelection({ ...r, selectedVehicleIds: [...r.selectedVehicleIds.slice(1), "zzz"] })).toBe(false);
  });
  it("false on malformed record", () => {
    expect(verifySelection({ ...genuine(), percent: NaN })).toBe(false);
  });
});

describe("AC9 scale", () => {
  it("200,000 vehicles at 25% in under 2s", () => {
    const vehicles = ids(200_000);
    const t = performance.now();
    const out = computeSelection(vehicles, 25, "s");
    expect(performance.now() - t).toBeLessThan(2000);
    expect(out).toHaveLength(50_000);
  });
});

describe("AC10 validation", () => {
  const store = () => new Map<string, SelectionRecord>();
  it.each([NaN, -1, 101, Infinity, 1.1, 0.5])("percent %s", (p) => {
    expect(() => selectForQuarter(store(), input({ percent: p }))).toThrow(ValidationError);
    expect(() => computeSelection(ids(3), p, "s")).toThrow(ValidationError);
  });
  it.each(["2026-Q5", "2026-Q0", "26-Q1", "2026Q1", "2026-q1", ""])("quarter %j", (q) => {
    expect(() => selectForQuarter(store(), input({ quarter: q }))).toThrow(ValidationError);
  });
  it("empty companyId", () => {
    expect(() => selectForQuarter(store(), input({ companyId: "" }))).toThrow(ValidationError);
  });
  it("empty vehicle id", () => {
    expect(() => selectForQuarter(store(), input({ vehicleIds: ["a", ""] }))).toThrow(ValidationError);
  });
});

describe("AC11 seed", () => {
  it("generates a 64-hex seed when none passed and stores it", () => {
    const store = new Map<string, SelectionRecord>();
    const { seed: _, ...rest } = input();
    const r = selectForQuarter(store, rest);
    expect(r.seed).toMatch(/^[0-9a-f]{64}$/);
    expect(store.get("c1:2026-Q4")?.seed).toBe(r.seed);
    expect(r.algorithm).toBe("sha256-rank-v1");
    expect(verifySelection(r)).toBe(true);
  });
  it("uses crypto.randomBytes(32); seeds differ", () => {
    const { seed: _, ...rest } = input();
    const a = selectForQuarter(new Map(), rest);
    const b = selectForQuarter(new Map(), rest);
    expect(crypto.randomBytes).toHaveBeenCalledWith(32);
    expect(a.seed).not.toBe(b.seed);
  });
});

describe("sha256-rank-v1 known answer", () => {
  it("pins ranking and seed use", () => {
    const v = ["v3", "v1", "v2", "v5", "v4", "v1", "v6", "v7"];
    expect(computeSelection(v, 40, "abc")).toEqual(["v2", "v6", "v7"]);
  });
});
