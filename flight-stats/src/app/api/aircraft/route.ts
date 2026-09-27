import { NextResponse } from "next/server";

import { fetchActiveAircraft } from "@/lib/flightlogger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const aircraft = await fetchActiveAircraft();

    return NextResponse.json(
      {
        aircraft,
        syncedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Erro desconhecido ao consultar a frota FlightLogger.";
    const code =
      error instanceof Error && error.name === "FLIGHTLOGGER_NOT_CONFIGURED"
        ? "FLIGHTLOGGER_NOT_CONFIGURED"
        : "FLIGHTLOGGER_API_ERROR";

    console.error("FlightLogger fleet sync failed", error);

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
