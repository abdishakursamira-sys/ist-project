import { Request, Response } from "express";
import { z } from "zod";
import * as auth from "../services/auth.service";

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  // bcrypt only uses the first 72 bytes, so cap there. Require a letter and a digit.
  password: z.string().min(10).max(72)
    .regex(/[A-Za-z]/, "Password needs a letter").regex(/\d/, "Password needs a number"),
  displayName: z.string().trim().min(1).max(50),
  // [7] exactly three different genres
  favoriteGenreIds: z.array(z.number().int().positive()).length(3)
    .refine((a) => new Set(a).size === 3, "Pick 3 different genres"),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(72),
});

export async function register(req: Request, res: Response) {
  res.status(201).json({ token: await auth.register(registerSchema.parse(req.body)) });
}

export async function login(req: Request, res: Response) {
  const { email, password } = loginSchema.parse(req.body);
  res.json({ token: await auth.login(email, password) });
}
