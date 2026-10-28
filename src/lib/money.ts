import { z } from "zod";

const MAX_BIGINT = BigInt("9223372036854775807");

export const paiseSchema = z
  .string()
  .regex(/^[1-9]\d*$/, "Amount must be a positive integer number of paise")
  .refine((value) => BigInt(value) <= MAX_BIGINT, "Amount exceeds the supported range");

export const optionalPaiseSchema = paiseSchema.nullable().optional();

export const parsePaise = (value: string): bigint => BigInt(value);

export const paiseToJson = (value: bigint): string => value.toString();
