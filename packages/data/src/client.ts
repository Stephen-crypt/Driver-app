import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type GeraClient = SupabaseClient;

export function createGeraClient(url: string, anonKey: string): GeraClient {
  if (!url) throw new Error("SUPABASE_URL is required");
  if (!anonKey) throw new Error("SUPABASE_ANON_KEY is required");

  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
}
