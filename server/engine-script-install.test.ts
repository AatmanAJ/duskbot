import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installScriptEngine, scriptInstallerOf } from "./engine-script-install.ts";
import { serverInstallFor } from "./engine-install.ts";
import { resetPathCacheForTests } from "./env-path.ts";
import { removeTempDir } from "./testing/cleanup.ts";

describe("scriptInstallerOf", () => {
  it("reads the vendors' one-liners as a URL and a shell", () => {
    const cursor = { command: { darwin: "curl https://cursor.com/install -fsS | bash", linux: "curl https://cursor.com/install -fsS | bash", win32: "irm 'https://cursor.com/install?win32=true' | iex" } };
    expect(scriptInstallerOf(cursor, "darwin")).toEqual({ url: "https://cursor.com/install", shell: "bash" });
    expect(scriptInstallerOf(cursor, "win32")).toEqual({ url: "https://cursor.com/install?win32=true", shell: "powershell" });
    expect(scriptInstallerOf({ command: { linux: "curl -fsSL https://app.factory.ai/cli | sh" } }, "linux")).toEqual({ url: "https://app.factory.ai/cli", shell: "sh" });
    expect(scriptInstallerOf({ command: { win32: "iex (irm https://hermes-agent.nousresearch.com/install.ps1)" } }, "win32"))
      .toEqual({ url: "https://hermes-agent.nousresearch.com/install.ps1", shell: "powershell" });
  });

  it("takes nothing that is not a plain https installer piped to a shell", () => {
    const refused = ["npm install -g x", "curl http://plain.test/i.sh | bash", "curl https://a.test/i.sh | bash; echo extra", "curl https://a.test/i.sh | sudo bash", "brew install x"];
    for (const line of refused) expect(scriptInstallerOf({ command: { linux: line } }, "linux")).toBeNull();
    expect(scriptInstallerOf({ command: { linux: "curl -fsSL https://a.test/i.sh | bash" } }, "darwin")).toBeNull();
  });

  it("is the last way serverInstallFor offers, after a standalone build and npm", () => {
    const script = "curl -fsSL https://a.test/i.sh | bash";
    expect(serverInstallFor({ command: { linux: script } }, true, "linux")).toEqual({ script: true });
    expect(serverInstallFor({ command: { linux: "npm install -g pkg" }, installer: { linux: script } }, true, "linux")).toEqual({ package: "pkg" });
    expect(serverInstallFor({ command: { linux: "npm install -g pkg" }, installer: { linux: script } }, false, "linux")).toEqual({ script: true });
    expect(serverInstallFor({ command: { linux: "npm install -g pkg" } }, false, "linux")).toBeNull();
  });
});

describe.skipIf(process.platform === "win32")("installScriptEngine", () => {
  let scratch = "";
  const path = process.env.PATH;
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "script-install-"));
    mkdirSync(join(scratch, "bin"));
    process.env.PATH = `${join(scratch, "bin")}:/usr/bin:/bin`;
    resetPathCacheForTests();
  });
  afterEach(() => {
    process.env.PATH = path;
    resetPathCacheForTests();
    removeTempDir(scratch);
  });

  const served = (body: string, status = 200) =>
    (async () => Object.defineProperty(new Response(body, { status }), "url", { value: "https://vendor.test/install.sh" })) as unknown as typeof fetch;

  it("downloads the script, runs it without a terminal or workspace keys, and finds the CLI it left", async () => {
    const target = join(scratch, "bin", "vendorcli");
    const ran = join(scratch, "ran");
    const script = `printf '#!/bin/sh\\necho ok\\n' > '${target}'\nchmod +x '${target}'\necho "key=\${XAI_API_KEY:-none} ci=$CI" > '${ran}'\n`;
    process.env.XAI_API_KEY = "fixture-not-a-secret";
    try {
      await installScriptEngine({ url: "https://vendor.test/ok.sh", shell: "sh" }, { cli: "vendorcli", fetchImpl: served(script) });
    } finally { delete process.env.XAI_API_KEY; }
    expect(readFileSync(ran, "utf8").trim()).toBe("key=none ci=1");
  });

  it("fails in plain words when the installer exits non-zero, leaves no CLI, or can't be downloaded", async () => {
    await expect(installScriptEngine({ url: "https://vendor.test/a.sh", shell: "sh" }, { cli: "vendorcli", fetchImpl: served("exit 3\n") }))
      .rejects.toThrow(/stopped before it finished/);
    await expect(installScriptEngine({ url: "https://vendor.test/b.sh", shell: "sh" }, { cli: "nothere", fetchImpl: served("true\n") }))
      .rejects.toThrow(/was not found afterwards/);
    await expect(installScriptEngine({ url: "https://vendor.test/c.sh", shell: "sh" }, { fetchImpl: served("nope", 404) }))
      .rejects.toThrow(/could not be downloaded/);
  });

  it("starts the installed CLI once on Windows before the install answers, and a CLI that fails to start does not fail it", async () => {
    const target = join(scratch, "bin", "vendorcli");
    const started = join(scratch, "started");
    const script = `printf '#!/bin/sh\\necho "$1" >> ${started}\\nexit 7\\n' > '${target}'\nchmod +x '${target}'\n`;
    await installScriptEngine({ url: "https://vendor.test/win.sh", shell: "sh" }, { cli: "vendorcli", platform: "win32", fetchImpl: served(script) });
    expect(readFileSync(started, "utf8").trim()).toBe("--version");
    await installScriptEngine({ url: "https://vendor.test/mac.sh", shell: "sh" }, { cli: "vendorcli", platform: "darwin", fetchImpl: served(script) });
    expect(readFileSync(started, "utf8").trim()).toBe("--version");
  });

  it("joins a request made while the same installer runs instead of starting it again", async () => {
    const runs = join(scratch, "runs");
    const script = `echo run >> '${runs}'\nsleep 0.3\n`;
    const first = installScriptEngine({ url: "https://vendor.test/join.sh", shell: "sh" }, { fetchImpl: served(script) });
    const again = installScriptEngine({ url: "https://vendor.test/join.sh", shell: "sh" }, { fetchImpl: served(script) });
    expect(again).toBe(first);
    await Promise.all([first, again]);
    expect(readFileSync(runs, "utf8").trim().split("\n")).toEqual(["run"]);
  });

  it("stops an installer that runs past its deadline", async () => {
    const started = Date.now();
    await expect(installScriptEngine({ url: "https://vendor.test/slow.sh", shell: "sh" }, { timeoutMs: 300, fetchImpl: served("sleep 30\n") }))
      .rejects.toThrow(/took too long/);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
