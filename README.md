# quarterly-selection

Auditable, reproducible random selection of vehicles for quarterly inspection. Algorithm `sha256-rank-v1`.

## Prerequisites

Node >= 22.12, npm. Commands are for a macOS/Linux shell (on Windows, use WSL or Git Bash).

## Install and test

```sh
git clone https://github.com/ishtian-revee/quarterly-selection.git
cd quarterly-selection
npm install
npm test   # 39 tests pass
```

## Usage

```sh
printf 'v1\nv2\nv3\nv4\nv5\nv6\nv7\nv8\n' > vehicles.txt

npm run -s select -- --company acme --quarter 2026-Q4 --percent 25 \
  --vehicles vehicles.txt --store records.json > record.json

npm run -s verify -- --record record.json   # prints VALID, exit 0 (INVALID, exit 1)
```

`-s` silences npm's banner so stdout is clean JSON.

`record.json` looks like this. 8 vehicles at 25% picks `ceil(8 * 25 / 100) = 2`. The seed is random, so your seed and picked vehicles will differ from this example:

```json
{
  "companyId": "acme",
  "quarter": "2026-Q4",
  "percent": 25,
  "algorithm": "sha256-rank-v1",
  "seed": "cc9090ae8dc3c4f1f40310778166ed172b880b35e25bb3dbe7e751a7c6dfc602",
  "eligibleVehicleIds": ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8"],
  "selectedVehicleIds": ["v5", "v6"],
  "createdAt": "2026-10-11T08:32:05.856Z"
}
```

Tamper with a record and `verify` catches it:

```sh
sed 's/"percent": 25/"percent": 50/' record.json > tampered.json
npm run -s verify -- --record tampered.json   # prints INVALID, exit 1
```

Exit codes: `0` valid, `1` invalid record, `2` bad input (missing flag, bad percent, or a different percent for an existing company and quarter, e.g. `acme:2026-Q4 already selected at 25%, got 30%`).

## Files

- `src/selection.ts`: the algorithm (`computeSelection`), one selection per company and quarter (`selectForQuarter`), and `verifySelection`. No file I/O.
- `src/cli.ts`: the `select` and `verify` commands; reads the vehicle file and saves records to the `--store` JSON file.
- `test/`: tests for the algorithm, the CLI, and this README.

Running `select` again with the same company and quarter returns the stored record unchanged, even if `vehicles.txt` changed. A different `--percent` for the same company and quarter is an error. Selections for different companies or quarters are independent, and earlier picks never exclude vehicles.

## How it works

1. `eligible` = sorted unique vehicle IDs; `n = eligible.length`.
2. `k = ceil(n * percent / 100)`.
3. `score(id) = sha256(seed + ":" + id)` as lowercase hex.
4. Sort by score ascending (ties by ID), take the first `k`, return them sorted.

The seed is 32 random bytes (hex) from `crypto.randomBytes`, created once when the selection is first made and stored in the record with the eligible-vehicle snapshot.

## Auditor: reproducing a selection

1. Get the stored record (`seed`, `percent`, `eligibleVehicleIds`, `selectedVehicleIds`).
2. Check `eligibleVehicleIds` against the company's active vehicle list as of `createdAt`. An unselected ID can be added to or removed from the snapshot without changing the pick, so this comparison is the control for that.
3. Run `npm run -s verify -- --record record.json`; it should print `VALID`.
4. Or recompute by hand: `k = ceil(n * percent / 100)`; for every ID compute `sha256("<seed>:<id>")` in hex; sort by that hex string ascending (ties by ID); the first `k` IDs, sorted, must equal `selectedVehicleIds`.

## Complexity

Time O(n log n): hashing is O(n), the sort dominates. Space O(n). 200,000 vehicles run in well under 2 seconds.

## Edge case: why the seed is random

A seed derived from company + quarter (for example `sha256("acme:2026-Q4")`) would be predictable: anyone, including the inspected company, could compute the pick in advance and prepare. A seed created at selection time with a CSPRNG is unpredictable beforehand; storing it makes the result reproducible afterwards.

Weakness left: the operator who runs the selection could regenerate seeds until one is favourable, then store that one. Stronger options:

- **Commit-reveal:** the operator publishes `sha256(seed)` before the vehicle list is frozen, then reveals the seed afterwards. Auditors check the hash matches.
- **Public randomness beacon** (for example drand): derive the seed from a beacon value for a round published after the list is frozen, so nobody controls it.
