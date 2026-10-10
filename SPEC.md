# Spec: auditable quarterly vehicle selection

## Problem

Every quarter, a share of each company's active vehicles is picked at random for a surprise safety inspection. Regulators can ask for proof that the pick was fair.

Requirements:
- **Fair:** every eligible vehicle has an equal chance.
- **Unpredictable beforehand:** nobody, including the company being inspected, can compute the pick in advance.
- **Reproducible afterwards:** an auditor can recompute the pick from the stored inputs.
- **Once per company per quarter:** running it again returns the same selection, never a new one.
- **No memory between quarters:** a vehicle picked last quarter is still eligible this quarter.
- **Scale:** works for 20 vehicles and for 200,000.

## Stack

TypeScript (strict), Node >= 22.12, Vitest for tests, tsx to run the CLI. No framework, no database. Dependencies are limited to `typescript`, `vitest`, `tsx` and `@types/node`.

## Design

**Algorithm (`sha256-rank-v1`):**
1. Remove duplicate IDs: `eligible = sorted unique vehicleIds`.
2. `k = ceil(n * percent / 100)`, where `n = eligible.length`.
3. Give each vehicle the score `sha256(seed + ":" + vehicleId)` as hex.
4. Sort by score ascending, breaking ties by vehicleId, and take the first k.
5. Return the selected IDs sorted ascending.

**Seed:** 32 bytes from `crypto.randomBytes`, as hex, generated when the selection is first created. Tests can pass in a seed.

**Record (what gets stored):**
```ts
type SelectionRecord = {
  companyId: string;
  quarter: string;              // "2026-Q4"
  percent: number;
  algorithm: "sha256-rank-v1";
  seed: string;                 // hex
  eligibleVehicleIds: string[]; // sorted, deduped snapshot
  selectedVehicleIds: string[]; // sorted
  createdAt: string;            // ISO
};
```

**Functions:**
- `computeSelection(vehicleIds, percent, seed): string[]`: pure.
- `selectForQuarter(store, { companyId, quarter, vehicleIds, percent, seed? }): SelectionRecord`
  - If a record already exists for `(companyId, quarter)`, return it unchanged. The vehicle list may have changed since the first run; that's expected and doesn't change the result.
  - If a record exists but the `percent` is different, throw a conflict error. A different percentage means the caller has a bug.
  - `store` is a plain `Map` keyed by `${companyId}:${quarter}`.
- `verifySelection(record): boolean`: recomputes the pick from `seed`, `eligibleVehicleIds` and `percent`, and compares it with `selectedVehicleIds`.

**CLI:**
- `select --company <id> --quarter <YYYY-Qn> --percent <p> --vehicles <file, one id per line> --store <records.json>`: prints the record. Run twice, it returns the same record.
- `verify --record <record.json>`: prints `VALID` or `INVALID` and exits with code 0 or 1.

## Acceptance criteria

Each criterion needs at least one test that names its ID.

- **AC1** `k = ceil(n * percent / 100)`. `n = 0` gives `[]`, `percent = 0` gives `[]`, `percent = 100` gives every vehicle.
- **AC2** Same inputs and seed give the same selection, whatever order the input is in.
- **AC3** Different seeds give different selections (checked on a fixture where a collision is negligible).
- **AC4** Duplicate vehicle IDs are removed before `n` is computed.
- **AC5** Fairness: with 20 vehicles at 25% over 20,000 deterministic seeds (`trial-<i>`), each vehicle's selection count is within ±5% of 5,000. The test must be deterministic, never flaky.
- **AC6** Idempotency: a second `selectForQuarter` call for the same company and quarter returns a deep-equal record, even if the vehicle list changed. A different percent throws a conflict error. Different companies and different quarters are independent.
- **AC7** The previous quarter's pick doesn't exclude anyone from the next quarter.
- **AC8** `verifySelection` returns true for a genuine record and false if `seed`, `eligibleVehicleIds`, `percent` or `selectedVehicleIds` has been tampered with.
- **AC9** 200,000 vehicles at 25% finishes in under 2 seconds.
- **AC10** Validation errors for: percent that is NaN, not an integer, below 0 or above 100; a quarter that isn't `YYYY-Q[1-4]`; an empty companyId; an empty vehicle ID.
- **AC11** When no seed is passed, a 64-hex-char seed is generated with `crypto.randomBytes` and stored in the record.
- **AC12** CLI smoke test: `select` twice returns the same record, and `verify` gives `VALID`; after tampering it gives `INVALID`.
- **AC13** README contains:
  - prerequisites, install, test and CLI usage (copy-paste runnable on a fresh machine)
  - the auditor's step-by-step reproduction procedure
  - a time and space complexity note
  - the edge case: a seed derived from company + quarter would be predictable
  - commit–reveal and public randomness beacon as stronger options

## Complexity target

Time O(n log n) (hashing O(n) plus the sort). Space O(n).
