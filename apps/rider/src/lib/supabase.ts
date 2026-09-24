import AsyncStorage from "@react-native-async-storage/async-storage";
import { createGeraClient } from "@gera/data";

// React Native has no localStorage, which is what supabase-js reaches for by
// default. Without this adapter persistSession is a no-op and the session dies
// on every app restart, dumping an already-registered user back at onboarding.
export const supabase = createGeraClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  AsyncStorage,
);
