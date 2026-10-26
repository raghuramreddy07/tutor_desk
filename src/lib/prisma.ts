import "../config/env";
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
