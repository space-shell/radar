import "./guard.mjs";
const { writeOpen, OPEN_PATH } = await import("../server/ledger.ts");
const { readFileSync } = await import("node:fs");
await writeOpen();
console.log(readFileSync(OPEN_PATH, "utf8"));
