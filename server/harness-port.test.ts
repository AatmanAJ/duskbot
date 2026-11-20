import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";

import { exitWhenPortTaken, portTakenMessage } from "./harness-port.ts";

describe("a taken port", () => {
  it("says which port is taken and how to fix it, then exits 1 instead of throwing", async () => {
    const holder = createServer();
    await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", resolve));
    const port = (holder.address() as AddressInfo).port;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const second = createServer();
      const exited = new Promise<number>((resolve) => exitWhenPortTaken(second, port, resolve));
      second.listen(port, "127.0.0.1");
      expect(await exited).toBe(1);
      expect(error).toHaveBeenCalledWith(portTakenMessage(port));
      expect(portTakenMessage(port)).toContain(`port ${port} is already in use`);
      expect(portTakenMessage(port)).toContain("DUSK_PORT");
    } finally {
      error.mockRestore();
      await new Promise((resolve) => holder.close(resolve));
    }
  });
});
