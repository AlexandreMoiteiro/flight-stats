import { NextResponse } from "next/server";

import type { Flight, FlightStatsResponse } from "@/lib/flight-types";
import { fetchFlightStats } from "@/lib/flightlogger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function elapsedMinutes(offBlock: string | null, onBlock: string | null): number {
  if (!offBlock || !onBlock) return 0;

  const start = new Date(offBlock).getTime();
  const end = new Date(onBlock).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;

  const minutes = Math.round((end - start) / 60_000);
  return minutes > 0 && minutes <= 24 * 60 ? minutes : 0;
}

function normalizeAccountFlight(flight: Flight): Flight {
  const blockMinutes = elapsedMinutes(flight.off_block, flight.on_block);
  const dayNightMinutes = flight.day_minutes + flight.night_minutes;
  const vfrMinutes =
    flight.single_engine_vfr_minutes + flight.multi_engine_vfr_minutes;
  const ifrMinutes =
    flight.single_engine_ifr_minutes + flight.multi_engine_ifr_minutes;
  const conditionsMinutes = vfrMinutes + ifrMinutes;

  const hasAirports = Boolean(
    flight.departure_airport_name || flight.arrival_airport_name,
  );
  const looksLikeSimulator =
    flight.synthetic_training_minutes > 0 ||
    (!hasAirports && dayNightMinutes === 0 && conditionsMinutes === 0);

  const calculatedMinutes = Math.max(
    flight.total_minutes,
    dayNightMinutes,
    conditionsMinutes,
    blockMinutes,
  );

  const aircraft = (flight.type_of_aircraft ?? "").toUpperCase();
  const isSingleEngine =
    aircraft === "PA-28" || aircraft === "P2008" || aircraft === "SEP";
  const isMultiEngine =
    aircraft === "P2006T" || aircraft === "MULTIENGINE" || aircraft === "MEP";

  const totalMinutes = looksLikeSimulator ? 0 : calculatedMinutes;
  const simulatorMinutes = looksLikeSimulator
    ? Math.max(flight.synthetic_training_minutes, blockMinutes)
    : flight.synthetic_training_minutes;

  const isPic = Boolean(flight.name_of_pilot_in_command) && !looksLikeSimulator;
  const inferredPicMinutes = isPic
    ? Math.max(flight.pilot_in_command_minutes, totalMinutes)
    : flight.pilot_in_command_minutes;
  const inferredDualMinutes =
    !isPic && !looksLikeSimulator
      ? Math.max(flight.dual_minutes, totalMinutes)
      : flight.dual_minutes;

  return {
    ...flight,
    total_minutes: totalMinutes,
    pilot_in_command_minutes: inferredPicMinutes,
    dual_minutes: inferredDualMinutes,
    synthetic_training_minutes: simulatorMinutes,
    single_engine_vfr_minutes: isSingleEngine ? vfrMinutes : 0,
    single_engine_ifr_minutes: isSingleEngine ? ifrMinutes : 0,
    multi_engine_vfr_minutes: isMultiEngine ? vfrMinutes : 0,
    multi_engine_ifr_minutes: isMultiEngine ? ifrMinutes : 0,
  };
}

function normalizeResponse(data: FlightStatsResponse): FlightStatsResponse {
  return {
    ...data,
    flights: data.flights.map(normalizeAccountFlight),
  };
}

export async function GET() {
  try {
    const data = normalizeResponse(await fetchFlightStats());

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Erro desconhecido ao consultar o FlightLogger.";
    const code =
      error instanceof Error && error.name === "FLIGHTLOGGER_NOT_CONFIGURED"
        ? "FLIGHTLOGGER_NOT_CONFIGURED"
        : "FLIGHTLOGGER_API_ERROR";

    console.error("FlightLogger sync failed", error);

    return NextResponse.json(
      { error: message, code },
      {
        status: code === "FLIGHTLOGGER_NOT_CONFIGURED" ? 503 : 502,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }
}
