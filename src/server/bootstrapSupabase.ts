import { setRuntimeSupabaseConfig } from "../lib/runtimeConfig";
import { getRuntimeSupabaseConfig } from "./runtimeConfig";

export const bootstrapSupabase = (): void => {
  setRuntimeSupabaseConfig(getRuntimeSupabaseConfig());
};

bootstrapSupabase();
