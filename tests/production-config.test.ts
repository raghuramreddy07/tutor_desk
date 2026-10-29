import { describe, expect, it, vi } from "vitest";
import {
  assertNonSuperuserConnection,
  productionConfigurationIssues,
} from "../src/config/production";

const strongSecret = "F7!qL9#vP2@xR5$kM8^cT3&z".repeat(2);

describe("production configuration safeguards", () => {
  it("rejects placeholder secrets and a missing CORS allowlist", () => {
    const issues = productionConfigurationIssues({
      nodeEnv: "production",
      jwtSecret: "replace-this-with-a-long-placeholder-secret",
      corsOrigins: "",
    });

    expect(issues).toContain(
      "JWT_SECRET must be a strong, non-placeholder secret of at least 32 characters",
    );
    expect(issues).toContain(
      "CORS_ORIGINS must contain at least one allowed origin",
    );
  });

  it("accepts a strong secret and explicit HTTP origins", () => {
    expect(
      productionConfigurationIssues({
        nodeEnv: "production",
        jwtSecret: strongSecret,
        corsOrigins: "https://app.example.com,https://admin.example.com",
      }),
    ).toEqual([]);
  });

  it("rejects wildcard and malformed production origins", () => {
    expect(
      productionConfigurationIssues({
        nodeEnv: "production",
        jwtSecret: strongSecret,
        corsOrigins: "*,not-an-origin",
      }),
    ).toEqual(
      expect.arrayContaining([
        "CORS_ORIGINS must not contain wildcard origins",
        "CORS_ORIGINS must contain valid http or https origins",
      ]),
    );
  });

  it("refuses production connections that are superusers or table owners", async () => {
    await expect(
      assertNonSuperuserConnection(async () => ({
        isSuperuser: true,
        ownsTables: false,
      })),
    ).rejects.toThrow("must not use a PostgreSQL superuser");
    await expect(
      assertNonSuperuserConnection(async () => ({
        isSuperuser: false,
        ownsTables: true,
      })),
    ).rejects.toThrow("must not own PostgreSQL tables");
    await expect(
      assertNonSuperuserConnection(vi.fn().mockResolvedValue({
        isSuperuser: false,
        ownsTables: false,
      })),
    ).resolves.toBeUndefined();
  });
});
