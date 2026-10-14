// Run an audit from the terminal:  npm run audit -- example.com [--json]
import { runAudit } from "../src/audit/run.ts";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--"));
if (!url) {
  console.error("Usage: npm run audit -- <url> [--json]");
  process.exit(1);
}
const r = await runAudit(url);
if (args.includes("--json")) {
  console.log(JSON.stringify(r, null, 2));
} else {
  console.log(`\n${r.site.name} (${r.finalUrl})  ${r.score}/100  ${r.grade}  [${r.durationMs} ms]`);
  console.log(`Platform: ${r.site.platform || "?"}  CDN: ${r.site.cdn || "?"}  Words: ${r.site.wordCount}\n`);
  for (const g of r.groups) console.log(`  ${g.title.padEnd(24)} ${g.earned}/${g.points}`);
  console.log();
  for (const c of r.checks) {
    const icon = { pass: "✓", warn: "!", fail: "✗", info: "i" }[c.status];
    console.log(`${icon} [${String(c.earned).padStart(4)}/${String(c.points).padEnd(2)}] ${c.title}: ${c.summary}`);
  }
}
