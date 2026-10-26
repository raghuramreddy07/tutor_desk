import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { env } from "../config/env";

interface AccessTokenPayload extends JwtPayload {
  userId: string;
  centerId: string;
  role: Role;
  typ: "access";
}

interface SelectionTokenPayload extends JwtPayload {
  userId: string;
  typ: "select";
}

const signToken = (
  payload: AccessTokenPayload | SelectionTokenPayload,
  expiresIn: SignOptions["expiresIn"],
): string => jwt.sign(payload, env.JWT_SECRET, { expiresIn });

export const createAccessToken = (input: {
  userId: string;
  centerId: string;
  role: Role;
}): string =>
  signToken({ ...input, typ: "access" }, env.JWT_EXPIRES_IN as SignOptions["expiresIn"]);

export const createSelectionToken = (userId: string): string =>
  signToken({ userId, typ: "select" }, "5m");

const verifyToken = (token: string): JwtPayload => {
  const payload = jwt.verify(token, env.JWT_SECRET);
  if (typeof payload === "string") {
    throw new Error("JWT payload must be an object");
  }
  return payload;
};

export const verifyAccessToken = (token: string): AccessTokenPayload => {
  const payload = verifyToken(token);
  if (
    payload.typ !== "access" ||
    typeof payload.userId !== "string" ||
    typeof payload.centerId !== "string" ||
    !["OWNER", "TEACHER", "PARENT"].includes(payload.role as string)
  ) {
    throw new Error("Invalid access token");
  }
  return payload as AccessTokenPayload;
};

export const verifySelectionToken = (token: string): SelectionTokenPayload => {
  const payload = verifyToken(token);
  if (payload.typ !== "select" || typeof payload.userId !== "string") {
    throw new Error("Invalid selection token");
  }
  return payload as SelectionTokenPayload;
};
