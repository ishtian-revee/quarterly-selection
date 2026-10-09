# quarterly-selection

Auditable, reproducible random selection of vehicles for quarterly inspection. Algorithm `sha256-rank-v1`.

## Prerequisites

Node >= 22.12, npm.

## Install and test

```sh
npm install
npm test
```

## Usage

```sh
printf 'v1\nv2\nv3\nv4\nv5\nv6\nv7\nv8\n' > vehicles.txt

npm run -s select -- --company acme --quarter 2026-Q4 --percent 25 \
  --vehicles vehicles.txt --store records.json > record.json

npm run -s verify -- --record record.json   # prints VALID, exit 0 (INVALID, exit 1)
```

`-s` silences npm's banner so stdout is clean JSON.

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

## Postgres: once per company per quarter

In production the `Map` store is replaced by a table whose constraint gives the same guarantee, even with concurrent runs:

```sql
CREATE TABLE vehicle_selections (
  id                    BIGSERIAL PRIMARY KEY,
  company_id            TEXT        NOT NULL,
  quarter               TEXT        NOT NULL CHECK (quarter ~ '^\d{4}-Q[1-4]$'),
  percent               SMALLINT    NOT NULL CHECK (percent BETWEEN 0 AND 100),
  algorithm             TEXT        NOT NULL,
  seed                  TEXT        NOT NULL,
  eligible_vehicle_ids  TEXT[]      NOT NULL,
  selected_vehicle_ids  TEXT[]      NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, quarter)
);
```

Insert with `ON CONFLICT (company_id, quarter) DO NOTHING`, then read the row back and return it; reject if its `percent` differs.
