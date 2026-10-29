require("dotenv/config");

const bcrypt = require("bcrypt");
const { PrismaClient } = require("@prisma/client");

const CENTER_ID = "a1000000-0000-4000-8000-000000000001";
const OWNER_ID = "a2000000-0000-4000-8000-000000000001";
const TEACHER_ID = "a2000000-0000-4000-8000-000000000002";
const PARENT_ID = "a2000000-0000-4000-8000-000000000003";
const BATCH_ID = "a3000000-0000-4000-8000-000000000001";
const STUDENT_IDS = [
  "a4000000-0000-4000-8000-000000000001",
  "a4000000-0000-4000-8000-000000000002",
  "a4000000-0000-4000-8000-000000000003",
];
const EXAM_ID = "a5000000-0000-4000-8000-000000000001";
const DEMO_DATE = new Date("2026-10-15T00:00:00.000Z");
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

const fail = (message) => {
  process.stderr.write(
    `${JSON.stringify({ level: "error", message })}\n`,
  );
  process.exitCode = 1;
};

const main = async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Demo seeding is disabled in production");
  }
  if (process.env.DEMO_SEED_CONFIRM !== "true") {
    throw new Error("Set DEMO_SEED_CONFIRM=true to seed demo data");
  }
  if (!process.env.DIRECT_URL) {
    throw new Error("DIRECT_URL is required");
  }
  if (!DEMO_PASSWORD || DEMO_PASSWORD.length < 8) {
    throw new Error("DEMO_PASSWORD must be at least 8 characters");
  }

  const ownerEmail = (
    process.env.DEMO_OWNER_EMAIL || "owner@demo.tutordesk.local"
  )
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    throw new Error("DEMO_OWNER_EMAIL must be a valid email address");
  }
  const centerName =
    process.env.DEMO_CENTER_NAME?.trim() || "TutorDesk Demo Center";
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL } },
  });

  try {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

    await prisma.$transaction(async (transaction) => {
      await transaction.center.upsert({
        where: { id: CENTER_ID },
        create: { id: CENTER_ID, name: centerName },
        update: { name: centerName },
      });

      await transaction.$queryRaw`
        SELECT set_config('app.current_center', ${CENTER_ID}, true)
      `;

      const users = [
        {
          id: OWNER_ID,
          name: "Demo Owner",
          email: ownerEmail,
          role: "OWNER",
        },
        {
          id: TEACHER_ID,
          name: "Demo Teacher",
          email: "teacher@demo.tutordesk.local",
          role: "TEACHER",
        },
        {
          id: PARENT_ID,
          name: "Demo Parent",
          email: "parent@demo.tutordesk.local",
          role: "PARENT",
        },
      ];

      for (const user of users) {
        await transaction.user.upsert({
          where: { id: user.id },
          create: {
            id: user.id,
            name: user.name,
            email: user.email,
            passwordHash,
          },
          update: {
            name: user.name,
            email: user.email,
            passwordHash,
          },
        });
        await transaction.membership.upsert({
          where: {
            userId_centerId: { userId: user.id, centerId: CENTER_ID },
          },
          create: {
            userId: user.id,
            centerId: CENTER_ID,
            role: user.role,
          },
          update: { role: user.role },
        });
      }

      const studentNames = [
        { name: "Aarav Sharma", grade: "Grade 8" },
        { name: "Mira Patel", grade: "Grade 9" },
        { name: "Kabir Rao", grade: "Grade 8" },
      ];
      for (const [index, student] of studentNames.entries()) {
        await transaction.student.upsert({
          where: { id: STUDENT_IDS[index] },
          create: {
            id: STUDENT_IDS[index],
            centerId: CENTER_ID,
            ...student,
          },
          update: student,
        });
      }

      await transaction.parentStudent.upsert({
        where: {
          userId_studentId: {
            userId: PARENT_ID,
            studentId: STUDENT_IDS[0],
          },
        },
        create: {
          centerId: CENTER_ID,
          userId: PARENT_ID,
          studentId: STUDENT_IDS[0],
        },
        update: { centerId: CENTER_ID },
      });

      await transaction.batch.upsert({
        where: { id: BATCH_ID },
        create: {
          id: BATCH_ID,
          centerId: CENTER_ID,
          name: "Foundation Mathematics",
          subject: "Mathematics",
          schedule: "Mon, Wed, Fri at 4:00 PM",
        },
        update: {
          name: "Foundation Mathematics",
          subject: "Mathematics",
          schedule: "Mon, Wed, Fri at 4:00 PM",
        },
      });

      await transaction.batchTeacher.upsert({
        where: { batchId_userId: { batchId: BATCH_ID, userId: TEACHER_ID } },
        create: {
          centerId: CENTER_ID,
          batchId: BATCH_ID,
          userId: TEACHER_ID,
        },
        update: { centerId: CENTER_ID },
      });

      for (const studentId of STUDENT_IDS) {
        await transaction.batchStudent.upsert({
          where: {
            centerId_batchId_studentId: {
              centerId: CENTER_ID,
              batchId: BATCH_ID,
              studentId,
            },
          },
          create: { centerId: CENTER_ID, batchId: BATCH_ID, studentId },
          update: {},
        });
      }

      await transaction.exam.upsert({
        where: { id: EXAM_ID },
        create: {
          id: EXAM_ID,
          centerId: CENTER_ID,
          batchId: BATCH_ID,
          name: "October Mathematics Check-in",
          maxMarks: 100,
          date: DEMO_DATE,
        },
        update: {
          name: "October Mathematics Check-in",
          maxMarks: 100,
          date: DEMO_DATE,
        },
      });

      const marks = [88, 76, 93];
      for (const [index, studentId] of STUDENT_IDS.entries()) {
        await transaction.attendance.upsert({
          where: {
            batchId_studentId_date: {
              batchId: BATCH_ID,
              studentId,
              date: DEMO_DATE,
            },
          },
          create: {
            centerId: CENTER_ID,
            batchId: BATCH_ID,
            studentId,
            date: DEMO_DATE,
            status: index === 1 ? "LATE" : "PRESENT",
            markedByUserId: OWNER_ID,
          },
          update: {
            status: index === 1 ? "LATE" : "PRESENT",
            markedByUserId: OWNER_ID,
          },
        });
        await transaction.examResult.upsert({
          where: {
            examId_studentId: { examId: EXAM_ID, studentId },
          },
          create: {
            centerId: CENTER_ID,
            examId: EXAM_ID,
            studentId,
            marks: marks[index],
          },
          update: { marks: marks[index] },
        });
      }
    });

    process.stdout.write(
      `${JSON.stringify({
        level: "info",
        message: "TutorDesk demo data seeded",
        centerId: CENTER_ID,
        accounts: [
          ownerEmail,
          "teacher@demo.tutordesk.local",
          "parent@demo.tutordesk.local",
        ],
      })}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((error) => {
  fail(error instanceof Error ? error.message : "Unknown demo seed error");
});
