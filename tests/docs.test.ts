import type { RequestMethod } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app, moduleRouteMounts } from "../src/app";
import { env } from "../src/config/env";
import { openApiSpec } from "../src/docs/openapi";

type RouteLayer = {
  route?: {
    path: string | string[];
    methods: Record<string, boolean>;
  };
};

type RouterWithStack = {
  stack: RouteLayer[];
};

const documentedRoutes = (): string[] =>
  Object.entries(openApiSpec.paths).flatMap(([path, pathItem]) =>
    Object.keys(pathItem).map((method) => `${method.toUpperCase()} ${path}`),
  );

const mountedRoutes = (): string[] => {
  const methods = new Set<RequestMethod>([
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
  ]);
  const routes: string[] = [];

  const addRouterRoutes = (prefix: string, router: object): void => {
    const stack = (router as RouterWithStack).stack;
    for (const layer of stack) {
      if (!layer.route) {
        continue;
      }
      const localPaths = Array.isArray(layer.route.path)
        ? layer.route.path
        : [layer.route.path];
      for (const localPath of localPaths) {
        const path = `/${[prefix, localPath]
          .filter(Boolean)
          .map((part) => part.replace(/^\/+|\/+$/g, ""))
          .filter(Boolean)
          .join("/")}`.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
        for (const method of methods) {
          if (layer.route.methods[method.toLowerCase()]) {
            routes.push(`${method} ${path}`);
          }
        }
      }
    }
  };

  for (const mount of moduleRouteMounts) {
    addRouterRoutes(mount.prefix ?? "", mount.router);
  }
  addRouterRoutes("", app.router);
  return [...new Set(routes)].sort();
};

describe("OpenAPI documentation", () => {
  it("documents every registered application endpoint", () => {
    expect(documentedRoutes().sort()).toEqual(mountedRoutes());
  });

  it("serves the OpenAPI document and the docs page only when enabled", async () => {
    const specResponse = await request(app).get("/docs/openapi.json");
    const pageResponse = await request(app).get("/docs/");

    if (env.ENABLE_DOCS) {
      expect(specResponse.status).toBe(200);
      expect(specResponse.body.openapi).toBe("3.1.0");
      expect(pageResponse.status).toBe(200);
      expect(pageResponse.text).toContain("swagger-ui");
    } else {
      expect(specResponse.status).toBe(404);
      expect(pageResponse.status).toBe(404);
    }
  });
});
