import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL, assertServerConfig } from "./config.js";

assertServerConfig();

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

export function toHttpError(error, fallbackStatus = 500) {
  if (!error) {
    return null;
  }

  const status =
    Number(error.status) ||
    Number(error.code) ||
    (String(error.message || "").includes("not_found") ? 404 : fallbackStatus);

  return {
    status: Number.isFinite(status) && status >= 400 && status <= 599 ? status : fallbackStatus,
    message: error.message || "Erro no Supabase",
    details: error.details || error.hint || null
  };
}
