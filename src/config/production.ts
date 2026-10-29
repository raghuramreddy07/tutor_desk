export type ProductionSettings = {
  nodeEnv: string;
  jwtSecret: string;
  corsOrigins: string;
};

const placeholderSecretPattern =
  /(change[-_ ]?me|replace[-_ ]?this|example|sample|placeholder|password|secret|your[-_ ]|development|test[-_ ]?secret)/i;

export const productionConfigurationIssues = (
  settings: ProductionSettings,
): string[] => {
  if (settings.nodeEnv !== "production") {
    return [];
  }

  const issues: string[] = [];
  const distinctCharacters = new Set(settings.jwtSecret).size;
  if (
    settings.jwtSecret.length < 32 ||
    distinctCharacters < 12 ||
    placeholderSecretPattern.test(settings.jwtSecret)
  ) {
    issues.push(
      "JWT_SECRET must be a strong, non-placeholder secret of at least 32 characters",
    );
  }

  const origins = settings.corsOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    issues.push("CORS_ORIGINS must contain at least one allowed origin");
  }
  if (origins.some((origin) => origin === "*" || origin.includes("*"))) {
    issues.push("CORS_ORIGINS must not contain wildcard origins");
  }
  if (
    origins.some((origin) => {
      try {
        const parsed = new URL(origin);
        return !["http:", "https:"].includes(parsed.protocol);
      } catch {
        return true;
      }
    })
  ) {
    issues.push("CORS_ORIGINS must contain valid http or https origins");
  }

  return issues;
};

export const assertNonSuperuserConnection = async (
  readRoleState: () => Promise<{ isSuperuser: boolean; ownsTables: boolean }>,
): Promise<void> => {
  const role = await readRoleState();
  if (role.isSuperuser) {
    throw new Error(
      "The application database connection must not use a PostgreSQL superuser",
    );
  }
  if (role.ownsTables) {
    throw new Error(
      "The application database connection must not own PostgreSQL tables",
    );
  }
};
