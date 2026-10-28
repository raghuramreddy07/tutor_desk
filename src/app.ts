import express from "express";
import { prisma } from "./lib/prisma";
import { globalErrorHandler, notFound } from "./middleware/errors";
import { authRoutes } from "./modules/auth/routes";
import { authMiddleware } from "./middleware/auth";
import { tenantMiddleware } from "./middleware/tenant";
import { studentRoutes } from "./modules/students/routes";
import { inviteRoutes } from "./modules/invites/routes";
import { memberRoutes } from "./modules/members/routes";

export const app = express();

app.use(express.json());

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ok", db: "up" });
  } catch (error) {
    console.error("Health check database query failed:", error);
    res.status(503).json({ status: "error", db: "down" });
  }
});

app.use("/auth", authRoutes);

app.get("/me", authMiddleware, tenantMiddleware, async (req, res) => {
  const [user, center] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: req.auth.userId },
      select: { id: true, name: true, email: true },
    }),
    prisma.center.findUniqueOrThrow({
      where: { id: req.auth.centerId },
      select: { id: true, name: true, plan: true },
    }),
  ]);

  res.status(200).json({ user, center, role: req.auth.role });
});

app.use("/students", studentRoutes);
app.use("/invites", inviteRoutes);
app.use("/members", memberRoutes);

app.use(notFound);
app.use(globalErrorHandler);
