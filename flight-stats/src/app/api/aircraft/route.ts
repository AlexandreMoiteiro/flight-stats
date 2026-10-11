import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { Flight } from "@/lib/flight-types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("flight_stats_flights")
      .select("registration,payload")
      .not("registration", "is", null)
      .order("date", { ascending: false })
      .limit(1000);
    if (error) throw error;
    const fleet = new Map<string, {
      registration: string;
      model: string | null;
      aircraftClass: "SINGLE_ENGINE" | "MULTI_ENGINE" | null;
    }>();
    for (const row of data ?? []) {
      const flight = row.payload as Flight;
      const registration = String(row.registration ?? "").toUpperCase();
      if (!registration || fleet.has(registration) || flight.synthetic_training_minutes > 0) continue;
      fleet.set(registration, {
        registration,
        model: flight.type_of_aircraft,
        aircraftClass: flight.multi_engine_vfr_minutes + flight.multi_engine_ifr_minutes > 0
          ? "MULTI_ENGINE" : "SINGLE_ENGINE",
      });
    }
    return NextResponse.json(
      { aircraft: [...fleet.values()], source: "supabase-archive" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Fleet archive query failed", error);
    return NextResponse.json({ error: "Não foi possível carregar a frota." }, { status: 503 });
  }
}
