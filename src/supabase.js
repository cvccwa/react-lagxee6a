import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.REACT_APP_SUPABASE_ANON_KEY || "placeholder"
);
