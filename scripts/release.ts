// Commands for dataset releases. Run from the project folder, with the variables of .env:
//   npm run release -- publish [--dry-run]
//   npm run release -- download <version|latest> <folder>
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "../server/firebase.js";
import { downloadRelease, publishRelease } from "../server/release.js";
import { getStorage } from "../server/storage.js";

const [command, ...args] = process.argv.slice(2);

async function main(): Promise<void> {
  if (command === "publish") {
    const result = await publishRelease(getDb(), getStorage(), { dryRun: args.includes("--dry-run") });
    console.log(`${args.includes("--dry-run") ? "Dry run of" : "Published"} release v${result.version}: ${result.rows} recordings.`);
    console.log(result.files.join("\n"));
  } else if (command === "download" && args.length === 2) {
    const version = args[0] === "latest" ? "latest" : Number(args[0].replace(/^v/, ""));
    const result = await downloadRelease(getStorage(), version, args[1], async (file, data) => {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data);
    });
    console.log(`Downloaded release v${result.version}: ${result.rows} recordings, in ${args[1]}.`);
  } else {
    console.error("Usage: npm run release -- publish [--dry-run] | download <version|latest> <folder>");
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
