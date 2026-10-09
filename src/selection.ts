import { createHash, randomBytes } from "node:crypto";

export type SelectionRecord = {
  companyId: string;
  quarter: string;
  percent: number;
  algorithm: "sha256-rank-v1";
  seed: string;
  eligibleVehicleIds: string[];
  selectedVehicleIds: string[];
  createdAt: string;
};

export class ValidationError extends Error {}
export class ConflictError extends Error {}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function validate(vehicleIds: string[], percent: number) {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new ValidationError(`percent must be an integer 0-100, got ${percent}`);
  if (vehicleIds.some((v) => typeof v !== "string" || v === "")) throw new ValidationError("empty vehicle id");
}

export function computeSelection(vehicleIds: string[], percent: number, seed: string): string[] {
  validate(vehicleIds, percent);
  const eligible = [...new Set(vehicleIds)].sort(cmp);
  const k = Math.ceil((eligible.length * percent) / 100);
  return eligible
    .map((id) => [sha(`${seed}:${id}`), id] as const)
    .sort((a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1]))
    .slice(0, k)
    .map(([, id]) => id)
    .sort(cmp);
}

export function selectForQuarter(
  store: Map<string, SelectionRecord>,
  a: { companyId: string; quarter: string; vehicleIds: string[]; percent: number; seed?: string },
): SelectionRecord {
  if (!a.companyId) throw new ValidationError("empty companyId");
  if (!/^\d{4}-Q[1-4]$/.test(a.quarter)) throw new ValidationError(`quarter must be YYYY-Qn, got ${a.quarter}`);
  validate(a.vehicleIds, a.percent);

  const key = `${a.companyId}:${a.quarter}`;
  const existing = store.get(key);
  if (existing) {
    if (existing.percent !== a.percent)
      throw new ConflictError(`${key} already selected at ${existing.percent}%, got ${a.percent}%`);
    return existing;
  }

  const seed = a.seed ?? randomBytes(32).toString("hex");
  const eligible = [...new Set(a.vehicleIds)].sort(cmp);
  const record: SelectionRecord = {
    companyId: a.companyId,
    quarter: a.quarter,
    percent: a.percent,
    algorithm: "sha256-rank-v1",
    seed,
    eligibleVehicleIds: eligible,
    selectedVehicleIds: computeSelection(eligible, a.percent, seed),
    createdAt: new Date().toISOString(),
  };
  store.set(key, record);
  return record;
}

export function verifySelection(r: SelectionRecord): boolean {
  try {
    if (r.algorithm !== "sha256-rank-v1") return false;
    const again = computeSelection(r.eligibleVehicleIds, r.percent, r.seed);
    return again.length === r.selectedVehicleIds.length && again.every((v, i) => v === r.selectedVehicleIds[i]);
  } catch {
    return false;
  }
}
