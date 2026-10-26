import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  createAccessToken,
  createSelectionToken,
  verifySelectionToken,
} from "../../lib/jwt";
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from "../../lib/password";
import { AppError } from "../../middleware/errors";
import type {
  LoginInput,
  SelectCenterInput,
  SignupCenterInput,
} from "./schemas";

export const signupCenter = async (input: SignupCenterInput) => {
  const passwordHash = await hashPassword(input.password);

  try {
    const result = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          name: input.name,
          email: input.email,
          phone: input.phone || null,
          passwordHash,
        },
        select: { id: true, name: true, email: true, phone: true },
      });
      const center = await transaction.center.create({
        data: { name: input.centerName },
        select: { id: true, name: true, plan: true },
      });
      await transaction.membership.create({
        data: {
          userId: user.id,
          centerId: center.id,
          role: "OWNER",
        },
      });

      return { user, center };
    });

    return {
      ...result,
      accessToken: createAccessToken({
        userId: result.user.id,
        centerId: result.center.id,
        role: "OWNER",
      }),
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AppError(409, "EMAIL_TAKEN", "An account with this email already exists");
    }
    throw error;
  }
};

export const login = async (input: LoginInput) => {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: {
      id: true,
      passwordHash: true,
      memberships: {
        select: {
          role: true,
          center: { select: { id: true, name: true } },
        },
      },
    },
  });
  const passwordMatches = await verifyPassword(
    input.password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );

  if (!user || !passwordMatches) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  if (user.memberships.length === 0) {
    throw new AppError(403, "NO_CENTER", "This account is not a member of any center");
  }

  if (user.memberships.length === 1) {
    const [membership] = user.memberships;
    return {
      accessToken: createAccessToken({
        userId: user.id,
        centerId: membership.center.id,
        role: membership.role,
      }),
      center: membership.center,
      role: membership.role,
    };
  }

  return {
    centers: user.memberships.map(({ center, role }) => ({
      ...center,
      role,
    })),
    selectionToken: createSelectionToken(user.id),
  };
};

export const selectCenter = async (input: SelectCenterInput) => {
  let selection: ReturnType<typeof verifySelectionToken>;
  try {
    selection = verifySelectionToken(input.selectionToken);
  } catch {
    throw new AppError(401, "UNAUTHORIZED", "Invalid selection token");
  }

  const membership = await prisma.membership.findUnique({
    where: {
      userId_centerId: {
        userId: selection.userId,
        centerId: input.centerId,
      },
    },
    select: {
      center: { select: { id: true, name: true } },
      role: true,
    },
  });

  if (!membership) {
    throw new AppError(403, "NOT_A_MEMBER", "You are not a member of this center");
  }

  return {
    accessToken: createAccessToken({
      userId: selection.userId,
      centerId: input.centerId,
      role: membership.role,
    }),
  };
};
