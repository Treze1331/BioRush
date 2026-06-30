import dotenv from "dotenv";

dotenv.config();

export const PORT = Number(process.env.PORT || 3000);
export const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";

export function assertServerConfig() {
  const missing = [];

  if (!SUPABASE_URL) {
    missing.push("SUPABASE_URL");
  }

  if (!SUPABASE_KEY) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_ANON_KEY");
  }

  if (missing.length) {
    throw new Error(`Variaveis de ambiente ausentes: ${missing.join(", ")}`);
  }
}
