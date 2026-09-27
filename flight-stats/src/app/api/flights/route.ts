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

function normalizeFlightTimes(flight: Flight): Flight {
  const blockMinutes = elapsedMinutes(flight.off_block, flight.on_block);
  const dayNightMinutes = flight.day_minutes + flight.night_minutes;
  const classifiedMinutes =
    flight.single_engine_vfr_minutes +
    flight.single_engine_ifr_minutes +
    flight.multi_engine_vfr_minutes +
    flight.multi_engine_ifr_minutes;

  const hasAirports = Boolean(
    flight.departure_airport_name || flight.arrival_airport_name,
  );
  const looksLikeSimulator =
    flight.synthetic_training_minutes > 0 ||
    (!hasAirports && dayNightMinutes === 0 && classifiedMinutes === 0);

  const totalMinutes = looksLikeSimulator
    ? 0
    : Math.max(
        flight.total_minutes,
        dayNightMinutes,
        classifiedMinutes,
        blockMinutes,
      );

  const simulatorMinutes = looksLikeSimulator
    ? Math.max(flight.synthetic_training_minutes, blockMinutes)
    : flight.synthetic_training_minutes;

  const hasRecordedRole =
    flight.pilot_in_command_minutes > 0 ||
    flight.co_pilot_minutes > 0 ||
    flight.dual_minutes > 0 ||
    flight.flight_instructor_minutes > 0;

  const inferPic =
    !hasRecordedRole &&
    Boolean(flight.name_of_pilot_in_command) &&
    !looksLikeSimulator;
  const inferDual =
    !hasRecordedRole &&
    !flight.name_of_pilot_in_command &&
    !looksLikeSimulator;

  const picMinutes = inferPic
    ? Math.max(flight.pilot_in_command_minutes, totalMinutes)
    : flight.pilot_in_command_minutes;
  const dualMinutes = inferDual
    ? Math.max(flight.dual_minutes, totalMinutes)
    : flight.dual_minutes;

  return {
    ...flight,
    total_minutes: totalMinutes,
    pilot_in_command_minutes: picMinutes,
    dual_minutes: dualMinutes,
    synthetic_training_minutes: simulatorMinutes,
  };
}

function normalizeResponse(data: FlightStatsResponse): FlightStatsResponse {
  return {
    ...data,
    flights: data.flights.map(normalizeFlightTimes),
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
