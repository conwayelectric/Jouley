/**
 * bump-build-number.mjs
 *
 * Reads the current iOS buildNumber from app.config.ts,
 * increments it by 1, and writes it back.
 *
 * Usage:
 *   node scripts/bump-build-number.mjs
 *
 * Called automatically by the GitHub Actions CI workflow
 * before every EAS build so you never need to manually
 * update the build number.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, "../app.config.ts");

const content = readFileSync(configPath, "utf8");

const match = content.match(/buildNumber:\s*"(\d+)"/);
if (!match) {
  console.error("❌ Could not find buildNumber in app.config.ts");
  process.exit(1);
}

const current = parseInt(match[1], 10);
const next = current + 1;

const updated = content.replace(
  /buildNumber:\s*"\d+"/,
  `buildNumber: "${next}"`
);

writeFileSync(configPath, updated, "utf8");
console.log(`✅ Build number bumped: ${current} → ${next}`);
