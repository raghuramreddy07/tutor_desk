import bcrypt from "bcrypt";

const BCRYPT_COST = 12;
export const DUMMY_PASSWORD_HASH =
  "$2b$12$Nwq1OE9BZrn3IF4zIJgHDuaNtpAO/iI/O9sF40M17URSlryHi0ak.";

export const hashPassword = (password: string): Promise<string> =>
  bcrypt.hash(password, BCRYPT_COST);

export const verifyPassword = (
  password: string,
  passwordHash: string,
): Promise<boolean> => bcrypt.compare(password, passwordHash);
