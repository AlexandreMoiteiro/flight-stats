import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import type { Flight, FlightLoggerProfile, FlightStatsResponse } from "@/lib/flight-types";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store, max-age=0" };
const allowedFlightTypes = new Set(["SOLO", "DUAL", "SPIC", "SIM"]);
const minuteFields = [
  "total_minutes", "day_minutes", "night_minutes",
  "single_engine_vfr_minutes", "single_engine_ifr_minutes",
  "multi_engine_vfr_minutes", "multi_engine_ifr_minutes",
  "pilot_in_command_minutes", "co_pilot_minutes", "multi_pilot_minutes",
  "flight_instructor_minutes", "dual_minutes", "spic_minutes",
  "synthetic_training_minutes", "instructor_synthetic_training_minutes",
  "if_time_minutes",
] as const;
const countFields = ["takeoffs_day", "takeoffs_night", "landings_day", "landings_night"] as const;

function textField(value: unknown, max = 160): string | null {
  if (typeof value !== "string") return null;
  return value.trim().slice(0, max) || null;
}

function minutes(value: unknown, max = 1440): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0 || n > max || !Number.isInteger(n)) {
    throw new Error("Os tempos e as contagens devem ser números inteiros válidos.");
  }
  return n;
}

function authorized(candidate: string | null, secret: string | undefined): boolean {
  if (!candidate || !secret) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function validateFlight(value: unknown): Flight {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Dados do voo inválidos.");
  }
  const input = value as Record<string, unknown>;
  const date = textField(input.date, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + "T00:00:00Z"))) {
    throw new Error("Indica uma data válida.");
  }
  const flightType = textField(input.flight_type, 8) ?? "DUAL";
  if (!allowedFlightTypes.has(flightType)) throw new Error("Tipo de voo inválido.");
  const sim = flightType === "SIM";

  const flight: Record<string, unknown> = {
    id: "manual-" + crypto.randomUUID(),
    date,
    departure_airport_name: sim ? null : textField(input.departure_airport_name, 40)?.toUpperCase() ?? null,
    arrival_airport_name: sim ? null : textField(input.arrival_airport_name, 40)?.toUpperCase() ?? null,
    type_of_aircraft: textField(input.type_of_aircraft, 80)?.toUpperCase(),
    registration: textField(input.registration, 40)?.toUpperCase(),
    name_of_pilot_in_command: textField(input.name_of_pilot_in_command, 160),
    instructor_name: textField(input.instructor_name, 160),
    flight_type: flightType,
    fstd_type: sim ? textField(input.fstd_type, 80) : null,
    fstd_model: sim ? textField(input.fstd_model, 80) : null,
    remarks_and_endorsements: textField(input.remarks_and_endorsements, 600),
    include_in_ftl: null,
  };

  for (const field of minuteFields) flight[field] = minutes(input[field]);
  for (const field of countFields) flight[field] = minutes(input[field], 30);

  if (sim) {
    flight.synthetic_training_minutes = Math.max(
      Number(flight.synthetic_training_minutes), Number(flight.total_minutes),
    );
    flight.total_minutes = 0;
    flight.day_minutes = 0;
    flight.night_minutes = 0;
  } else {
    if (!flight.departure_airport_name || !flight.arrival_airport_name) {
      throw new Error("Indica os aeródromos de partida e chegada.");
    }
    if (!flight.registration || !flight.type_of_aircraft) {
      throw new Error("Indica o modelo e a matrícula da aeronave.");
    }
    if (Number(flight.total_minutes) < 1) throw new Error("O tempo total de voo tem de ser superior a zero.");
    if (Number(flight.day_minutes) + Number(flight.night_minutes) > Number(flight.total_minutes)) {
      throw new Error("Dia + noite não podem ultrapassar o tempo total.");
    }
    if (Number(flight.spic_minutes) > Number(flight.pilot_in_command_minutes)) {
      throw new Error("SPIC não pode ultrapassar o tempo PIC.");
    }
  }

  for (const key of ["off_block", "on_block"]) {
    const raw = textField(input[key], 40);
    if (raw && !Number.isFinite(Date.parse(raw))) throw new Error("Hora UTC inválida.");
    flight[key] = raw ? new Date(raw).toISOString() : null;
  }
  if (flight.off_block && flight.on_block &&
    new Date(String(flight.on_block)).getTime() <= new Date(String(flight.off_block)).getTime()) {
    throw new Error("A hora de chegada deve ser posterior à hora de partida.");
  }

  return flight as Flight;
}

export async function GET() {
  try {
    const flights: Flight[] = [];
    const batch = 1000;
    for (let start = 0; start < 10000; start += batch) {
      const { data, error } = await supabase
        .from("flight_stats_flights")
        .select("payload")
        .order("date", { ascending: false })
        .order("id", { ascending: false })
        .range(start, start + batch - 1);
      if (error) throw error;
      flights.push(...(data ?? []).map((row) => row.payload as Flight));
      if ((data ?? []).length < batch) break;
    }
    const { data: meta, error: metaError } = await supabase
      .from("flight_stats_metadata")
      .select("profile,synced_at")
      .eq("id", "sevenair")
      .maybeSingle();
    if (metaError) throw metaError;
    const response: FlightStatsResponse = {
      flights,
      profile: (meta?.profile ?? { firstName: "", lastName: "", callSign: "" }) as FlightLoggerProfile,
      syncedAt: String(meta?.synced_at ?? new Date().toISOString()),
    };
    return NextResponse.json(response, { headers: noStore });
  } catch (error) {
    console.error("Supabase flight archive read failed", error);
    return NextResponse.json(
      { error: "Não foi possível carregar o histórico no Supabase.", code: "DATABASE_ERROR" },
      { status: 503, headers: noStore },
    );
  }
}

export async function POST(request: NextRequest) {
  const secret = process.env.FLIGHT_STATS_EDITOR_KEY;
  if (!authorized(request.headers.get("x-flight-stats-editor-key"), secret)) {
    return NextResponse.json({ error: "Chave de edição inválida." }, { status: 401, headers: noStore });
  }
  try {
    const raw = await request.json();
    const flight = validateFlight(raw);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey || !secret) throw new Error("Database not configured");
    const editor = createClient(url, anonKey, {
      auth: { persistSession: false },
      global: { headers: { "x-flight-stats-editor-key": secret } },
    });
    const { error } = await editor.from("flight_stats_flights").insert({
      id: flight.id, date: flight.date, registration: flight.registration,
      source: "manual", payload: flight,
    });
    if (error) throw error;
    return NextResponse.json({ flight }, { status: 201, headers: noStore });
  } catch (error) {
    console.error("Manual flight insertion failed", error);
    const message = error instanceof Error ? error.message : "Não foi possível guardar o voo.";
    const userError = /inválid|Indica|ultrapassar|superior|posterior|número|tempo PIC/i.test(message);
    return NextResponse.json(
      { error: userError ? message : "Não foi possível guardar o voo. Verifica os dados e tenta novamente." },
      { status: userError ? 400 : 500, headers: noStore },
    );
  }
}
