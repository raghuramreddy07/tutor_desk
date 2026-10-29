import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import { openApiSpec } from "../../docs/openapi";

export const docsRoutes = Router();

docsRoutes.get("/openapi.json", (_req, res) => {
  res.status(200).json(openApiSpec);
});

docsRoutes.use(
  "/",
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec, {
    customSiteTitle: "TutorDesk API Documentation",
    swaggerOptions: { persistAuthorization: false },
  }),
);
