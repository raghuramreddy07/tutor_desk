import express, { type Router } from "express";
import cors from "cors";
import helmet from "helmet";
import { prisma } from "./lib/prisma";
import { globalErrorHandler, notFound } from "./middleware/errors";
import { authRoutes } from "./modules/auth/routes";
import { authMiddleware } from "./middleware/auth";
import { tenantMiddleware } from "./middleware/tenant";
import { studentRoutes } from "./modules/students/routes";
import { inviteRoutes } from "./modules/invites/routes";
import { memberRoutes } from "./modules/members/routes";
import { batchRoutes } from "./modules/batches/routes";
import { attendanceRoutes } from "./modules/attendance/routes";
import { examRoutes } from "./modules/exams/routes";
import { feePlanRoutes } from "./modules/fee-plans/routes";
import { feeRoutes, studentFeeRoutes } from "./modules/fees/routes";
import { paymentRoutes } from "./modules/payments/routes";
import { parentRoutes } from "./modules/parent/routes";
import { planRoutes } from "./modules/plan/routes";
import { notificationRoutes } from "./modules/notifications/routes";
import { jobRoutes } from "./modules/jobs/routes";
import { env } from "./config/env";
import { globalIpRateLimit } from "./middleware/rateLimit";
import { requestContextMiddleware } from "./lib/requestContext";
import { auditRoutes } from "./modules/audit/routes";
import { requestLogger } from "./middleware/logging";
import { checkReadiness } from "./lib/databaseReadiness";
import { docsRoutes } from "./modules/docs/routes";

export const app = express();

app.set("trust proxy", env.TRUST_PROXY);
app.use(requestContextMiddleware);
app.use(requestLogger);
app.use(helmet());
const allowedOrigins = new Set(
  env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
);
app.use(
  cors({
    origin: (origin, callback) => {
      callback(null, origin === undefined || allowedOrigins.has(origin));
    },
    exposedHeaders: [
      "RateLimit-Limit",
      "RateLimit-Remaining",
      "RateLimit-Reset",
      "Retry-After",
      "X-Request-Id",
    ],
  }),
);
app.use(globalIpRateLimit);
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/ready", async (_req, res) => {
  const checks = await checkReadiness();
  const ready = checks.database && checks.redis;
  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    checks,
  });
});

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

type RouteMount = { prefix?: string; router: Router };

export const moduleRouteMounts: RouteMount[] = [
  { prefix: "/auth", router: authRoutes },
  { prefix: "/students", router: studentRoutes },
  { prefix: "/students", router: studentFeeRoutes },
  { prefix: "/invites", router: inviteRoutes },
  { prefix: "/members", router: memberRoutes },
  { prefix: "/batches", router: batchRoutes },
  { router: attendanceRoutes },
  { router: examRoutes },
  { prefix: "/fee-plans", router: feePlanRoutes },
  { prefix: "/fees", router: feeRoutes },
  { prefix: "/payments", router: paymentRoutes },
  { prefix: "/parent", router: parentRoutes },
  { prefix: "/plan", router: planRoutes },
  { prefix: "/notifications", router: notificationRoutes },
  { prefix: "/jobs", router: jobRoutes },
  { prefix: "/audit-logs", router: auditRoutes },
];

for (const mount of moduleRouteMounts) {
  if (mount.prefix) {
    app.use(mount.prefix, mount.router);
  } else {
    app.use(mount.router);
  }
}
if (env.ENABLE_DOCS) {
  app.use("/docs", docsRoutes);
}

app.use(notFound);
app.use(globalErrorHandler);
