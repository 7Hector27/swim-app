import { describe, expect, it, vi } from "vitest";
import { shutdown } from "../shutdown";

function makeLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
  };
}

function makeServer(opts: { closeErr?: Error } = {}) {
  const close = vi.fn((cb: (err?: Error) => void) => {
    cb(opts.closeErr);
  });
  return { close };
}

function makePool(opts: { endErr?: Error } = {}) {
  const end = vi.fn(async () => {
    if (opts.endErr) throw opts.endErr;
  });
  return { end };
}

describe("shutdown", () => {
  it("closes server, then pool, then exits 0", async () => {
    const server = makeServer();
    const pool = makePool();
    const logger = makeLogger();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    try {
      await shutdown({ server, pool, logger }, "SIGTERM");

      expect(server.close).toHaveBeenCalledOnce();
      expect(pool.end).toHaveBeenCalledOnce();
      expect(pool.end).toHaveBeenCalledWith({ timeout: 5 });
      // Pool close must happen AFTER server close (drain-then-close).
      expect(server.close.mock.invocationCallOrder[0]).toBeLessThan(
        pool.end.mock.invocationCallOrder[0]!,
      );
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      exit.mockRestore();
    }
  });

  it("still closes pool and exits even when server.close errors", async () => {
    const server = makeServer({ closeErr: new Error("already closed") });
    const pool = makePool();
    const logger = makeLogger();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    try {
      await shutdown({ server, pool, logger }, "SIGINT");

      expect(pool.end).toHaveBeenCalledOnce();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: "already closed" }),
        expect.stringContaining("server.close"),
      );
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      exit.mockRestore();
    }
  });

  it("logs and exits 0 when pool.end rejects", async () => {
    const server = makeServer();
    const pool = makePool({ endErr: new Error("pool stuck") });
    const logger = makeLogger();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    try {
      await shutdown({ server, pool, logger }, "SIGTERM");

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: "pool stuck" }),
        expect.stringContaining("pool close failed"),
      );
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      exit.mockRestore();
    }
  });
});
