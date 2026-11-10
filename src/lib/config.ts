import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  MOCK_PROVIDER_URL: z.string().url().default("http://localhost:4000"),
  MOCK_PROVIDER_WEBHOOK_SECRET: z.string().min(16, "MOCK_PROVIDER_WEBHOOK_SECRET must be at least 16 characters"),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Validates process.env once at boot (or on first access) and caches the result. Throws with a clear message on any missing/invalid value instead of failing later at the point of use. */
export function getConfig(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
