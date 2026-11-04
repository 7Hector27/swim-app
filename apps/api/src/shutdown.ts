import type { Logger } from "pino";

// Max time to let in-flight requests finish before we force-exit. 10s is
// the typical platform grace window (Railway sends SIGKILL after ~10s on
// top of SIGTERM) and keeps a hung keep-alive socket from pinning the
// process open past the point of usefulness.
const FORCE_EXIT_MS = 10_000;

// Minimal server + pool surfaces so tests can hand in plain mocks without
// spinning up a real http.Server or postgres-js Sql instance. The real
// http.Server.close and postgres-js Sql.end satisfy these shapes.
export interface ClosableServer {
  close(cb: (err?: Error) => void): unknown;
}

export interface ClosablePool {
  end(opts?: { timeout?: number }): Promise<void>;
}

export interface ShutdownDeps {
  server: ClosableServer;
  pool: ClosablePool;
  logger: Pick<Logger, "info" | "error">;
}

export function registerShutdown(deps: ShutdownDeps): void {
  const handle = (signal: "SIGTERM" | "SIGINT") => {
    void shutdown(deps, signal);
  };
  process.once("SIGTERM", () => handle("SIGTERM"));
  process.once("SIGINT", () => handle("SIGINT"));
}

export async function shutdown(
  { server, pool, logger }: ShutdownDeps,
  signal: "SIGTERM" | "SIGINT",
): Promise<void> {
  logger.info({ signal }, "shutdown: received signal");

  const forceExit = setTimeout(() => {
    logger.error({ signal, afterMs: FORCE_EXIT_MS }, "shutdown: force exit (timed out)");
    process.exit(1);
  }, FORCE_EXIT_MS);
  forceExit.unref();

  try {
    await new Promise<void>((resolve) => {
      server.close((err) => {
        if (err) {
          logger.error({ err: err.message }, "shutdown: server.close reported error");
        } else {
          logger.info({}, "shutdown: server closed");
        }
        resolve();
      });
    });

    try {
      await pool.end({ timeout: 5 });
      logger.info({}, "shutdown: pool closed");
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "shutdown: pool close failed",
      );
    }

    logger.info({}, "shutdown: exiting 0");
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "shutdown: unexpected error",
    );
    clearTimeout(forceExit);
    process.exit(1);
  }
}
