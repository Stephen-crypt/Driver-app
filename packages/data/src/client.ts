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

// Database, auth and network errors are written for developers. A rider or a
// passenger should never read "violates row-level security policy". The short
// codes our own functions raise (too_soon, not_your_trip, ...) are kept as they
// are: each screen translates those into its own words.
const TECHNICAL: readonly [RegExp, string][] = [
  [/failed to fetch|network request failed|networkerror|load failed|timeout/i, "No connection. Check your data or Wi-Fi and try again."],
  [/jwt|refresh token|not authenticated|unauthenticated/i, "You've been signed out. Sign in again to carry on."],
  [/row-level security|permission denied|violates|not_permitted/i, "This account can't do that."],
  [/duplicate key|already exists/i, "That's already been done."],
  [/relation|column|syntax|function .* does not exist|schema cache/i, "Something went wrong on our side. Try again in a minute."],
];

export function friendlyError(message: string): string {
  for (const [pattern, words] of TECHNICAL) if (pattern.test(message)) return words;
  return message;
}

/** The Error to throw for a failed Supabase call. */
export function dataError(message: string): Error {
  return new Error(friendlyError(message));
}
