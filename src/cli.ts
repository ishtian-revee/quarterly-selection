import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { selectForQuarter, type SelectionRecord, verifySelection } from "./selection";

const [cmd, ...rest] = process.argv.slice(2);
const { values: v } = parseArgs({
  args: rest,
  options: Object.fromEntries(
    ["company", "quarter", "percent", "vehicles", "store", "record"].map((n) => [n, { type: "string" as const }]),
  ),
});

try {
  if (cmd === "select") {
    const missing = ["company", "quarter", "percent", "vehicles", "store"].filter((n) => !v[n as keyof typeof v]);
    if (missing.length) throw new Error(`missing --${missing.join(", --")}`);
    const store = new Map<string, SelectionRecord>(
      existsSync(v.store!) ? Object.entries(JSON.parse(readFileSync(v.store!, "utf8"))) : [],
    );
    const vehicleIds = readFileSync(v.vehicles!, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const record = selectForQuarter(store, {
      companyId: v.company!,
      quarter: v.quarter!,
      percent: Number(v.percent),
      vehicleIds,
    });
    writeFileSync(v.store!, JSON.stringify(Object.fromEntries(store), null, 2));
    console.log(JSON.stringify(record, null, 2));
  } else if (cmd === "verify") {
    if (!v.record) throw new Error("missing --record");
    const ok = verifySelection(JSON.parse(readFileSync(v.record, "utf8")));
    console.log(ok ? "VALID" : "INVALID");
    process.exit(ok ? 0 : 1);
  } else {
    throw new Error("usage: select|verify (see README)");
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
}
