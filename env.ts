import { z } from "zod";

// Validated once at startup: the server refuses to boot with a missing or weak secret.
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  PORT: z.coerce.number().default(3000),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  ALLOW_SAMPLE_IMPORT: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  MATCH_SIM_FLOOR: z.coerce.number().min(0).max(0.9).default(0.2),
});

export const env = schema.parse(process.env);
