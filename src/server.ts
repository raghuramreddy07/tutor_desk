import { app } from "./app";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";
import { closeJobQueue } from "./jobs/queues";
import { redis } from "./lib/redis";

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

    void Promise.all([prisma.$disconnect(), closeJobQueue(), redis.quit()])
      .then(() => {
        if (!error) {
          console.log("Prisma and Redis disconnected");
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
