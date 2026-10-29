const directUrl = process.env.DIRECT_URL;
const appPassword = process.env.TUTORDESK_APP_PASSWORD;

if (!directUrl || !appPassword) {
  process.stderr.write(
    `${JSON.stringify({
      level: "fatal",
      message: "DIRECT_URL and TUTORDESK_APP_PASSWORD are required",
    })}\n`,
  );
  process.exit(1);
}

try {
  const appUrl = new URL(directUrl);
  if (!["postgres:", "postgresql:"].includes(appUrl.protocol)) {
    throw new Error("DIRECT_URL must use PostgreSQL");
  }

  appUrl.username = "tutordesk_app";
  appUrl.password = appPassword;
  process.env.DATABASE_URL = appUrl.toString();
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      level: "fatal",
      message: "Could not configure the application database URL",
      errorName: error instanceof Error ? error.name : "UnknownError",
    })}\n`,
  );
  process.exit(1);
}
