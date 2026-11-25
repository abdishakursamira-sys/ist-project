import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool, withTransaction } from "../config/db";
import { env } from "../config/env";
import { HttpError } from "../middleware/errors";

const BCRYPT_COST = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync("timing-equaliser", BCRYPT_COST);

const signToken = (userId: string) =>
  jwt.sign({}, env.JWT_SECRET, { subject: userId, expiresIn: "1h", algorithm: "HS256" });

export interface RegisterInput {
  email: string; password: string; displayName: string; favoriteGenreIds: number[];
}

/** [7][14] Creates the account and its 3 favourite genres atomically; returns a login token. */
export async function register(input: RegisterInput): Promise<string> {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  return withTransaction(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id`,
      [input.email, passwordHash, input.displayName],
    );
    const userId: string = rows[0].id;
    await db.query(
      `INSERT INTO user_favorite_genres (user_id, genre_id) SELECT $1, unnest($2::smallint[])`,
      [userId, input.favoriteGenreIds],
    );
    return signToken(userId);
  });
}

/** [14] Login with a generic error message and temporary lockout after repeated failures. */
export async function login(email: string, password: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT id, password_hash, status, failed_login_attempts, locked_until FROM users WHERE email = $1`,
    [email],
  );
  const user = rows[0];

  if (user?.locked_until && user.locked_until > new Date()) {
    throw new HttpError(429, "Too many failed attempts. Try again later.");
  }

  const passwordOk = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !passwordOk || user.status !== "active") {
    if (user) {
      const lockExpired = user.locked_until && user.locked_until <= new Date();
      const attempts = (lockExpired ? 0 : user.failed_login_attempts) + 1;
      const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null;
      await pool.query(`UPDATE users SET failed_login_attempts = $2, locked_until = $3 WHERE id = $1`,
        [user.id, attempts, lockedUntil]);
    }
    throw new HttpError(401, "Invalid email or password");
  }

  await pool.query(`UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`, [user.id]);
  return signToken(user.id);
}
