import express from "express";
import { prisma } from "./lib/prisma";
import { globalErrorHandler, notFound } from "./middleware/errors";

export const app = express();

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ok", db: "up" });
  } catch (error) {
    console.error("Health check database query failed:", error);
    res.status(503).json({ status: "error", db: "down" });
  }
});

app.use(notFound);
app.use(globalErrorHandler);
