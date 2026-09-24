import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type GeraClient = SupabaseClient;

/**
 * Typed structurally on purpose. supabase-js persists the session through
 * whatever storage it is handed, and on React Native that has to be
 * AsyncStorage - but this package is shared by both apps and any future Node
 * tooling, so it must not import React Native. The caller supplies the adapter.
 */
export interface GeraAuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function createGeraClient(
  url: string,
  anonKey: string,
  storage?: GeraAuthStorage,
): GeraClient {
  if (!url) throw new Error("SUPABASE_URL is required");
  if (!anonKey) throw new Error("SUPABASE_ANON_KEY is required");

  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      // Without an adapter supabase-js falls back to localStorage, which does
      // not exist on React Native: persistSession would silently do nothing and
      // the session would die on every app restart.
      ...(storage ? { storage } : {}),
    },
  });
}
