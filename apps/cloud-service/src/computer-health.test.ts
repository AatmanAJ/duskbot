import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CLOUD_HOME } from "../../../electron/legacy-names.mjs";
import { COMPUTER_CHECK_MARK, COMPUTER_CHECK_SCRIPT, computerCheckCommand } from "./home.ts";
import { COMPUTER_CHECK_MS, parseComputerCheck } from "./computer-health.ts";
import { cleanup, homeFixture } from "./test-fixture.ts";

describe("the computer check's answer", () => {
  it("reads ok, none, what was healed and what stays down; anything else is unknown", () => {
    expect(parseComputerCheck("ok\n", 1)).toMatchObject({ health: "ok", infra: false });
    expect(parseComputerCheck("none\n", 1)).toMatchObject({ health: "none", infra: false });
    expect(parseComputerCheck("healed units gate\n", 1)).toMatchObject({ health: "healed", fixed: ["units", "gate"], infra: true });
    expect(parseComputerCheck("healed gate-code\n", 1)).toMatchObject({ health: "healed", fixed: ["gate-code"], infra: false });
    expect(parseComputerCheck("healed units\n", 1)).toMatchObject({ health: "healed", infra: false });
    expect(parseComputerCheck("down docker\n", 1)).toMatchObject({ health: "down", down: "docker", infra: true });
    expect(parseComputerCheck("down gate\n", 1)).toMatchObject({ health: "down", down: "gate", infra: true });
    expect(parseComputerCheck("", 1)).toMatchObject({ health: "unknown", infra: false });
  });
});

describe.skipIf(process.platform === "win32")("the computer check on a machine", () => {
  /** the script against stand-ins: systemctl, curl and the clock read files in `dir`; docker and the gate are real sockets */
  async function machine() {
    const dir = mkdtempSync(join(tmpdir(), "dusk-computer-")); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const bin = join(dir, "bin"), etc = join(dir, "etc"), root = join(dir, "root");
    mkdirSync(bin); mkdirSync(etc); mkdirSync(root);
    const tool = (name: string, body: string) => { writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`); chmodSync(join(bin, name), 0o755); };
    tool("systemctl", `echo "$*" >> ${dir}/systemctl.log
case "$*" in
  "cat docker.service") exit 0 ;;
  "is-active --quiet docker.service") [ -f ${dir}/docker-up ]; exit $? ;;
  "is-active --quiet omb-docker-gate.service") [ -f ${dir}/gate-up ]; exit $? ;;
  "show -p ActiveEnterTimestamp --value omb-docker-gate.service") cat ${dir}/gate-started ;;
  "start docker.service"|"restart docker.service") [ -f ${dir}/docker-broken ] || touch ${dir}/docker-up ;;
  "restart omb-docker-gate.service") [ -f ${dir}/gate-broken ] || { touch ${dir}/gate-up; echo 200 > ${dir}/gate-started; } ;;
esac
exit 0`);
    // the gate answers 200 once it is up; docker answers its ping once it is up
    tool("curl", `sock=""; prev=""; for a in "$@"; do [ "$prev" = --unix-socket ] && sock="$a"; prev="$a"; done
if [ "$sock" = ${dir}/docker.sock ]; then [ -f ${dir}/docker-up ] && exit 0; exit 7; fi
if [ -f ${dir}/gate-up ] && [ ! -f ${dir}/gate-wedged ]; then printf 200; exit 0; fi
printf 000; exit 7`);
    tool("date", `echo "$2"`);
    tool("stat", `cat ${dir}/installed-at`);
    tool("sleep", "exit 0");
    writeFileSync(join(dir, "installed-at"), "100\n"); writeFileSync(join(root, "installed"), "x\n");
    const unit = join(etc, "omb-docker-gate.service");
    writeFileSync(unit, `[Service]\nExecStart=/usr/lib/node ${CLOUD_HOME.root}/app/link/docker-gate.mjs --listen ${join(dir, "gate.sock")} --upstream /var/run/docker.sock\n`);
    const listen = (path: string) => new Promise<void>(resolve => { const server = createServer().listen(path, () => resolve()); cleanup.push(() => new Promise<void>(r => server.close(() => r()))); });
    await listen(join(dir, "docker.sock")); await listen(join(dir, "gate.sock"));
    const script = COMPUTER_CHECK_SCRIPT.replaceAll("/etc/systemd/system", etc).replaceAll("/var/run/docker.sock", join(dir, "docker.sock")).replaceAll(CLOUD_HOME.root, root);
    writeFileSync(join(dir, "check"), script);
    const run = (refresh = false) => execFileSync("bash", [join(dir, "check"), ...(refresh ? ["refresh"] : [])], { encoding: "utf8", env: { PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: dir } }).trim();
    const asked = () => existsSync(join(dir, "systemctl.log")) ? readFileSync(join(dir, "systemctl.log"), "utf8") : "";
    const set = (flag: string, on = true) => { if (on) writeFileSync(join(dir, flag), ""); else rmSync(join(dir, flag), { force: true }); };
    return { dir, etc, run, asked, set };
  }

  it("is marked for the fake machine and is valid bash", () => {
    expect(COMPUTER_CHECK_SCRIPT).toContain(COMPUTER_CHECK_MARK);
    execFileSync("bash", ["-n", "-c", COMPUTER_CHECK_SCRIPT]);
  });

  it("restarts a gate that does not answer, makes docker want it, and changes nothing on a healthy machine", async () => {
    const m = await machine();
    m.set("docker-up"); m.set("gate-up"); m.set("gate-wedged"); writeFileSync(join(m.dir, "gate-started"), "200\n");
    // the wedged gate stops answering only until it restarts
    writeFileSync(join(m.dir, "bin", "systemctl"), readFileSync(join(m.dir, "bin", "systemctl"), "utf8").replace(`"restart omb-docker-gate.service") `, `"restart omb-docker-gate.service") rm -f ${m.dir}/gate-wedged; `));
    expect(m.run()).toBe("healed units gate");
    expect(m.asked()).toContain("restart omb-docker-gate.service");
    expect(m.asked()).not.toMatch(/(?:start|restart) docker\.service/);
    expect(readFileSync(join(m.etc, "omb-docker-gate.service.d", "dusk-heal.conf"), "utf8")).toContain("StartLimitIntervalSec=0");
    expect(readFileSync(join(m.etc, "docker.service.d", "dusk-gate.conf"), "utf8")).toContain("Wants=omb-docker-gate.service");
    const before = m.asked();
    expect(m.run()).toBe("ok");
    expect(m.asked().slice(before.length)).not.toMatch(/restart|daemon-reload/);
  });

  it("starts docker when it is down, and says so when it does not come back", async () => {
    const m = await machine();
    m.set("gate-up"); writeFileSync(join(m.dir, "gate-started"), "200\n");
    expect(m.run()).toBe("healed units docker");
    expect(m.asked()).toContain("start docker.service");
    m.set("docker-up", false); m.set("docker-broken");
    expect(m.run()).toBe("down docker");
  });

  it("restarts a gate still running an older package's code once, and only when asked to (the home is idle)", async () => {
    const m = await machine();
    m.set("docker-up"); m.set("gate-up"); writeFileSync(join(m.dir, "gate-started"), "50\n");
    expect(m.run()).toBe("healed units");
    expect(m.asked()).not.toContain("restart omb-docker-gate.service");
    expect(m.run(true)).toBe("healed gate-code");
    expect(m.run(true)).toBe("ok");
    m.set("gate-up", false); m.set("gate-broken");
    expect(m.run()).toBe("down gate");
  });

  it("sends the refresh only with the idle flag, under the fake machine's mark", () => {
    expect(computerCheckCommand(false)).toMatch(new RegExp(`' ${COMPUTER_CHECK_MARK}$`));
    expect(computerCheckCommand(true)).toMatch(new RegExp(`' ${COMPUTER_CHECK_MARK} refresh$`));
  });
});

describe("the reconciler's computer check", () => {
  it("checks a running home every 10 minutes and after a wake, alerts once per incident and logs when it answers again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    cleanup.push(() => warn.mockRestore());
    const f = await homeFixture();
    const { c } = await f.paid();
    const checks = () => f.api.requests.filter(r => r.path.endsWith("/exec") && (r.body as { cmd: string }).cmd.includes(COMPUTER_CHECK_MARK)).length;
    const actions = () => f.audit.entries(c.id).filter(e => e.action.startsWith("computer_")).map(e => `${e.action}:${e.reason}`);
    const pass = async (ms: number) => { f.advance(ms); c.nextAttemptAt = 0; await f.service.reconcile(); };
    await pass(61_000);
    expect(checks()).toBe(1);
    await pass(61_000);
    expect(checks()).toBe(1);
    f.api.computerAnswers("healed gate", "healed units gate", "ok");
    await pass(COMPUTER_CHECK_MS);
    await pass(COMPUTER_CHECK_MS);
    await pass(COMPUTER_CHECK_MS);
    expect(checks()).toBe(4);
    expect(actions()).toEqual(["computer_healed:periodic", "computer_healed:periodic", "computer_ok:recovered"]);
    expect(warn.mock.calls.filter(([line]) => String(line).includes("ALERT") && String(line).includes("bot computers"))).toHaveLength(1);
    expect(c.managed!.computer!.incident).toBeNull();
    expect(c.managed!.computer!.history.map(([, infra]) => infra)).toEqual([false, true, true, false]);

    await f.asleep(c);
    const before = checks();
    f.api.computerAnswers("down docker");
    c.wantPower = "on";
    await f.settle(c, x => x.status === "running", 20, 61_000);
    expect(checks()).toBe(before + 1);
    expect(actions().at(-1)).toBe("computer_down:wake");
    expect(c.managed!.computer!.incident).toMatchObject({ what: "down_docker" });
  });
});
