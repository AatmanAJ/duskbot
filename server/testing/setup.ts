// Every test file gets a throwaway home, so DATA_DIR (~/.duskbot) never touches the real one;
// os.homedir() reads HOME / USERPROFILE at call time, and this runs before server/config.ts is imported.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach } from "vitest";

import { LEGACY } from "../../electron/legacy-names.mjs";
import { removeTempDir } from "./cleanup.ts";

const home = mkdtempSync(join(tmpdir(), "dusk-test-home-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
// DUSK_DATA_DIR must never escape the throwaway home the suite deletes.
delete process.env.DUSK_DATA_DIR;
for (const prefix of LEGACY.envPrefixes) delete process.env[`${prefix}DATA_DIR`];
// Do not let a developer's Hermes global config path leak into per-test homes.
delete process.env.HERMES_HOME;
// Named explicitly although homedir() already covers it: the device tests delete this directory wholesale.
process.env.DUSK_COMPANION_DIR = join(home, ".duskbot-companion");

// Every registry lookup is also answered by a front-to-back search, and a difference fails the test.
process.env.DUSK_REGISTRY_SHADOW = "1";

// Product code follows navigator.language; pin it so English assertions do not depend on the host locale.
Object.defineProperty(globalThis.navigator, "language", { value: "en", configurable: true });

// Windows will not remove a directory holding an open SQLite database: close it before the reset.
const { closeMessageDb } = await import("../message-db.ts");
const { closeRegistryDbs } = await import("../registry-rows.ts");
const { flushDeferredSaves } = await import("../save-batch.ts");
// A save a test left waiting lands in its own folder now, as at shutdown, not in the next test's.
afterEach(() => { flushDeferredSaves(); closeMessageDb(); closeRegistryDbs(); });

// Windows holds a live process's cwd, and a just-killed CLI lets go a beat after the kill returns.
afterAll(async () => {
  closeMessageDb();
  closeRegistryDbs();
  await removeTempDir(home);
});
