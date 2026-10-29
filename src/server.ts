import { app } from "./app";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";
import { closeJobQueue } from "./jobs/queues";
import { redis } from "./lib/redis";
import { logger } from "./lib/logger";
import { verifyProductionDatabaseRole } from "./lib/productionDatabaseCheck";

type ApiServer = ReturnType<typeof app.listen>;
let server: ApiServer | undefined;

let isShuttingDown = false;

const shutdown = (signal: NodeJS.Signals): void => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info({ signal }, "API shutting down gracefully");

  const closeDependencies = (serverError?: Error): void => {
    if (serverError) {
      logger.error({ err: serverError }, "HTTP server shutdown failed");
      process.exitCode = 1;
    }

    void Promise.all([prisma.$disconnect(), closeJobQueue(), redis.quit()])
      .then(() => {
        logger.info("Prisma and Redis disconnected");
      })
      .catch((disconnectError: unknown) => {
        logger.error({ err: disconnectError }, "API dependency shutdown failed");
        process.exitCode = 1;
      });
  };

  if (!server) {
    closeDependencies();
    return;
  }

  server.close((error) => {
    if (error) {
      closeDependencies(error);
      return;
    }
    closeDependencies();
  });
};

void verifyProductionDatabaseRole()
  .then(() => {
    server = app.listen(env.PORT, () => {
      logger.info({ port: env.PORT }, "TutorDesk API listening");
    });
  })
  .catch((error: unknown) => {
    logger.fatal({ err: error }, "Could not start TutorDesk API");
    process.exitCode = 1;
    shutdown("SIGTERM");
  });

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
