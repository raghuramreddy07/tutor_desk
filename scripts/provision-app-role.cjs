require("dotenv/config");

const { PrismaClient } = require("@prisma/client");

// Every table the app role may touch, with exactly the privileges it needs.
// A table that is not listed here gets NO access (deny by default).
// When you add a new table in a migration, add it to a group below.
const grantGroups = [
  {
    privileges: "SELECT, INSERT, UPDATE, DELETE",
    tables: [
      "User",
      "Center",
      "Membership",
      "Student",
      "Invite",
      "ParentStudent",
      "Batch",
      "BatchTeacher",
      "BatchStudent",
      "Attendance",
      "Exam",
      "ExamResult",
      "FeePlan",
      "StudentFee",
      "FeeCharge",
      "CenterCounter",
      "Notification",
    ],
  },
  // Money trail: payments are voided, never deleted.
  // UPDATE is kept because voiding sets voidedAt / voidReason.
  // If your tests still pass, you can tighten PaymentAllocation to
  // "SELECT, INSERT".
  {
    privileges: "SELECT, INSERT, UPDATE",
    tables: ["Payment", "PaymentAllocation"],
  },
  // Append-only audit trail.
  { privileges: "SELECT, INSERT", tables: ["AuditLog"] },
  // Outbox rows are inserted, read, and marked dispatched.
  { privileges: "SELECT, INSERT, UPDATE", tables: ["JobOutbox"] },
];

const main = async () => {
  const directUrl = process.env.DIRECT_URL;
  const appPassword = process.env.TUTORDESK_APP_PASSWORD;
  if (!directUrl || !appPassword) {
    throw new Error("DIRECT_URL and TUTORDESK_APP_PASSWORD are required");
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: directUrl } },
  });

  try {
    // 1. Create the role if it does not exist yet.
    const createRole = await prisma.$queryRaw`
      SELECT format(
        'CREATE ROLE tutordesk_app LOGIN PASSWORD %L',
        ${appPassword}
      ) AS statement
      WHERE NOT EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = 'tutordesk_app'
      )
    `;
    if (createRole[0]) {
      await prisma.$executeRawUnsafe(createRole[0].statement);
    }

    // 2. Always enforce the safe role settings (also fixes an existing role).
    const roleSettings = await prisma.$queryRaw`
      SELECT format(
        'ALTER ROLE tutordesk_app WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
        ${appPassword}
      ) AS statement
    `;
    await prisma.$executeRawUnsafe(roleSettings[0].statement);

    // 3. Connection and schema access.
    const databaseGrant = await prisma.$queryRaw`
      SELECT format(
        'GRANT CONNECT ON DATABASE %I TO tutordesk_app',
        current_database()
      ) AS statement
    `;
    await prisma.$executeRawUnsafe(databaseGrant[0].statement);
    await prisma.$executeRaw`
      GRANT USAGE ON SCHEMA public TO tutordesk_app
    `;

    // 4. Clean slate: remove every table privilege granted earlier, so old
    //    or accidental grants cannot survive. Grants are rebuilt below.
    await prisma.$executeRaw`
      REVOKE ALL ON ALL TABLES IN SCHEMA public FROM tutordesk_app
    `;

    // 5. Remove any default privileges left by earlier versions of this
    //    script, so future tables do not get automatic access.
    const resetDefaults = await prisma.$queryRaw`
      SELECT format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM tutordesk_app',
        current_user
      ) AS statement
    `;
    await prisma.$executeRawUnsafe(resetDefaults[0].statement);

    // 6. Grant exactly what each table needs.
    for (const group of grantGroups) {
      for (const table of group.tables) {
        const grants = await prisma.$queryRaw`
          SELECT format(
            'GRANT %s ON TABLE %I.%I TO tutordesk_app',
            ${group.privileges},
            n.nspname,
            c.relname
          ) AS statement
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname = ${table}
            AND c.relkind IN ('r', 'p')
        `;
        if (grants[0]) {
          await prisma.$executeRawUnsafe(grants[0].statement);
        }
      }
    }

    // 7. Safety net: even if a group above is edited by mistake, these
    //    protections always end up in place.
    await prisma.$executeRaw`
      REVOKE DELETE, TRUNCATE ON TABLE "Payment", "PaymentAllocation" FROM tutordesk_app
    `;
    await prisma.$executeRaw`
      REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "AuditLog" FROM tutordesk_app
    `;

    process.stdout.write(
      `${JSON.stringify({
        level: "info",
        message: "tutordesk_app database role provisioned",
      })}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      level: "error",
      message: "Failed to provision tutordesk_app database role",
      errorName: error instanceof Error ? error.name : "UnknownError",
    })}\n`,
  );
  process.exitCode = 1;
});