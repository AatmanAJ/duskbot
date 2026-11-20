import { describe, expect, it, vi } from "vitest";
import { containerMemory, createMemoryGate, forceStopContainer, outOfMemoryText, parseContainerMemory, type DockerCall } from "./vps-container-health.ts";

const ID = "c".repeat(64);
const IMAGE = `sha256:${"a".repeat(64)}`;
const timedOut = () => Promise.reject(new Error("Docker-over-SSH command timed out"));
const noSleep = async () => {};

describe("forceStopContainer", () => {
  it("stops a healthy container with one bounded docker stop", async () => {
    const docker = vi.fn<DockerCall>().mockResolvedValue({ stdout: "" });
    await expect(forceStopContainer(docker, ID, noSleep)).resolves.toBe("stopped");
    expect(docker).toHaveBeenCalledTimes(1);
    expect(docker).toHaveBeenCalledWith(["stop", "--time", "10", ID], 30_000);
  });

  it("kills the container when docker stop hangs", async () => {
    const docker = vi.fn<DockerCall>().mockImplementationOnce(timedOut).mockResolvedValue({ stdout: "" });
    await expect(forceStopContainer(docker, ID, noSleep)).resolves.toBe("killed");
    expect(docker.mock.calls[1]).toEqual([["kill", ID], 20_000]);
  });

  it("kills the gVisor sandbox process on the host when stop and kill both hang", async () => {
    let state = `true 4242 ${IMAGE}`;
    const docker = vi.fn<DockerCall>(async (args) => {
      if (args[0] === "stop" || args[0] === "kill") return timedOut();
      if (args[0] === "inspect") return { stdout: state };
      if (args[0] === "run") { state = `false 0 ${IMAGE}`; return { stdout: "" }; }
      throw new Error(`unexpected ${args[0]}`);
    });
    await expect(forceStopContainer(docker, ID, noSleep)).resolves.toBe("sandbox-killed");
    const run = docker.mock.calls.find(([args]) => args[0] === "run")![0];
    expect(run).toEqual(expect.arrayContaining(["--rm", "--runtime", "runc", "--pid", "host", "--network", "none", IMAGE, "-c", 'kill -9 "$1"', "sh"]));
    expect(run.at(-1)).toBe("4242");
  });

  it("treats a container that already stopped as stopped", async () => {
    const docker = vi.fn<DockerCall>().mockRejectedValue(new Error(`Error response from daemon: Container ${ID} is not running`));
    await expect(forceStopContainer(docker, ID, noSleep)).resolves.toBe("stopped");
  });

  it("never runs the helper without a real process id and image", async () => {
    const docker = vi.fn<DockerCall>(async (args) => args[0] === "inspect" ? { stdout: "true 0 nginx:latest" } : timedOut());
    await expect(forceStopContainer(docker, ID, noSleep)).rejects.toThrow(/did not stop/);
    expect(docker.mock.calls.some(([args]) => args[0] === "run")).toBe(false);
  });

  it("reports a sandbox Docker still shows running after the kill", async () => {
    const docker = vi.fn<DockerCall>(async (args) => args[0] === "inspect" ? { stdout: `true 77 ${IMAGE}` } : args[0] === "run" ? { stdout: "" } : timedOut());
    await expect(forceStopContainer(docker, ID, noSleep)).rejects.toThrow(/still reports it running/);
  });
});

describe("container memory", () => {
  it("reads docker stats usage, limit and processes", () => {
    const memory = parseContainerMemory("7.18GiB / 7.2GiB\t355");
    expect(memory?.processes).toBe(355);
    expect(memory?.fraction).toBeCloseTo(7.18 / 7.2, 5);
    expect(parseContainerMemory("0B / 0B\t0")).toBeNull();
    expect(parseContainerMemory("garbage")).toBeNull();
  });

  it("asks docker stats once, bounded, for one container", async () => {
    const docker = vi.fn<DockerCall>().mockResolvedValue({ stdout: "512MiB / 2GiB\t12\n" });
    const memory = await containerMemory(docker, ID);
    expect(memory?.fraction).toBeCloseTo(0.25, 5);
    expect(docker).toHaveBeenCalledWith(["stats", "--no-stream", "--format", "{{.MemUsage}}\t{{.PIDs}}", ID], 15_000);
  });

  it("flags only pressure above 85%, caches briefly and reads a failed probe as unknown", async () => {
    let clock = 0;
    const gate = createMemoryGate(15_000, () => clock);
    const full = vi.fn(async () => parseContainerMemory("7.18GiB / 7.2GiB\t355"));
    expect(await gate.pressure(ID, full)).not.toBeNull();
    expect(await gate.pressure(ID, full)).not.toBeNull();
    expect(full).toHaveBeenCalledTimes(1);
    clock = 20_000;
    expect(await gate.pressure(ID, async () => parseContainerMemory("3GiB / 7.2GiB\t40"))).toBeNull();
    gate.forget(ID);
    expect(await gate.pressure(ID, () => Promise.reject(new Error("timed out")))).toBeNull();
  });

  it("explains the state in plain words", () => {
    expect(outOfMemoryText(parseContainerMemory("7.18GiB / 7.2GiB\t355")!)).toMatch(/^The shared computer is out of memory \(7\.2 of 7\.2 GB.*restart the shared computer in Settings > Computers\.$/);
  });
});
