import { app } from "./app";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";

const server = app.listen(env.PORT, () => {
  console.log(`TutorDesk API listening on port ${env.PORT}`);
});

let isShuttingDown = false;

const shutdown = (signal: NodeJS.Signals): void => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`${signal} received; shutting down gracefully`);

  server.close((error) => {
    if (error) {
      console.error("HTTP server shutdown failed:", error);
      process.exitCode = 1;
    }

    void prisma
      .$disconnect()
      .then(() => {
        if (!error) {
          console.log("Prisma disconnected");
        }
      })
      .catch((disconnectError: unknown) => {
        console.error("Prisma disconnect failed:", disconnectError);
        process.exitCode = 1;
      });
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
