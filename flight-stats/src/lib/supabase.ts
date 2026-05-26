import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (!supabaseUrl) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
}

if (!supabaseAnonKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
  },
});

export type Flight = {
  id: string;

  date: string | null;
  departure_airport_name: string | null;
  off_block: string | null;
  arrival_airport_name: string | null;
  on_block: string | null;

  type_of_aircraft: string | null;
  registration: string | null;
  name_of_pilot_in_command: string | null;

  total_minutes: number;
  day_minutes: number;
  night_minutes: number;

  single_engine_vfr_minutes: number;
  single_engine_ifr_minutes: number;
  multi_engine_vfr_minutes: number;
  multi_engine_ifr_minutes: number;

  pilot_in_command_minutes: number;
  co_pilot_minutes: number;
  multi_pilot_minutes: number;
  flight_instructor_minutes: number;
  dual_minutes: number;

  synthetic_training_minutes: number;
  instructor_synthetic_training_minutes: number;

  landings_day: number;
  landings_night: number;

  remarks_and_endorsements: string | null;
  include_in_ftl: boolean | null;
  if_time_minutes: number;

  raw?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
};

export type FlightDraft = Omit<Flight, "id" | "created_at" | "updated_at">;
export type FlightUpsert = Omit<Flight, "created_at" | "updated_at"> & {
  updated_at?: string;
};
