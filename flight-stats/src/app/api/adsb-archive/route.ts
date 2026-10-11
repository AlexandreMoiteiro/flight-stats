import { NextRequest, NextResponse } from "next/server";

import type { Flight } from "@/lib/flight-types";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ArchiveFlight = {
  registration?: string | null;
  callsign?: string | null;
  icao24?: string | null;
  start_ts?: string | null;
  end_ts?: string | null;
  path?: { type?: string; coordinates?: unknown };
  timestamps?: unknown;
};

type ArchiveResponse = { flights?: ArchiveFlight[] };

type Point = {
  observed_at: string;
  lat: number;
  lon: number;
  altitude_ft: number | null;
  ground_speed_kt: number | null;
  track_deg: number | null;
  vertical_rate_fpm: number | null;
  callsign: string | null;
  icao_hex: string | null;
  source: string;
};

function normalized(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function empty() {
  return NextResponse.json({ points: [], source: "adsb.aero" });
}

function parsePoints(
  candidate: ArchiveFlight,
  from: number,
  to: number,
): Point[] {
  const path = candidate.path?.coordinates;
  const stamps = candidate.timestamps;
  if (!Array.isArray(path) || !Array.isArray(stamps)) return [];
  // The archive supplies GeoJSON MultiLineString coordinates ([lon,lat,alt])
  // and matching per-segment Unix-second timestamps.
  const groups = candidate.path?.type === "LineString" ? [path] : path;
  const timeGroups = candidate.path?.type === "LineString" ? [stamps] : stamps;
  const parsed: Point[] = [];

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const coordinates = groups[groupIndex];
    const epochs = timeGroups[groupIndex];
    if (!Array.isArray(coordinates) || !Array.isArray(epochs)) continue;
    for (let index = 0; index < Math.min(coordinates.length, epochs.length); index += 1) {
      const coordinate = coordinates[index];
      if (!Array.isArray(coordinate) || coordinate.length < 2) continue;
      const lon = Number(coordinate[0]);
      const lat = Number(coordinate[1]);
      const seconds = Number(epochs[index]);
      const altitude = coordinate[2] === null || coordinate[2] === undefined
        ? null : Number(coordinate[2]);
      const millis = seconds * 1000;
      if (
        !Number.isFinite(lat) || !Number.isFinite(lon) ||
        Math.abs(lat) > 85 || Math.abs(lon) > 180 ||
        !Number.isFinite(millis) || millis < from || millis > to
      ) continue;

      parsed.push({
        observed_at: new Date(millis).toISOString(),
        lat, lon,
        altitude_ft: altitude !== null && Number.isFinite(altitude) ? altitude : null,
        ground_speed_kt: null,
        track_deg: null,
        vertical_rate_fpm: null,
        callsign: candidate.callsign ?? null,
        icao_hex: candidate.icao24 ?? null,
        source: "adsb.aero-history",
      });
    }
  }
  const unique = new Map<string, Point>();
  for (const point of parsed) {
    unique.set(point.observed_at + ":" + point.lat + ":" + point.lon, point);
  }
  return [...unique.values()]
    .sort((a, b) => a.observed_at.localeCompare(b.observed_at))
    .slice(0, 4000);
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("flightId") || "";
  if (!/^(?:manual-[0-9a-f-]{36}|account-flight-[0-9]+|[0-9A-Za-z_-]{1,80})$/.test(id)) {
    return NextResponse.json({ points: [] }, { status: 400 });
  }

  try {
    const { data, error } = await supabase
      .from("flight_stats_flights")
      .select("payload")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return empty();
    const flight = data.payload as Flight;
    const registration = normalized(flight.registration);
    const start = Date.parse(flight.off_block || "");
    const end = Date.parse(flight.on_block || "");
    if (registration.length < 4 || !Number.isFinite(start) ||
        !Number.isFinite(end) || end <= start || end - start > 24 * 3600_000) {
      return empty();
    }

    const from = start - 60 * 60_000;
    const to = end + 60 * 60_000;
    const response = await fetch("https://adsb.aero/api/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        match: { registration_prefix: registration },
        start_from: new Date(from).toISOString(),
        end_date: new Date(to).toISOString(),
        window_days: 2,
        include_path: true,
        limit: 100,
      }),
      signal: AbortSignal.timeout(9000),
      cache: "no-store",
    });

    if (!response.ok) return empty();
    const archived = (await response.json()) as ArchiveResponse;
    if (!Array.isArray(archived.flights)) return empty();

    const matches = archived.flights
      .filter((candidate) => normalized(candidate.registration) === registration)
      .filter((candidate) => {
        const first = Date.parse(candidate.start_ts || "");
        const last = Date.parse(candidate.end_ts || "");
        return Number.isFinite(first) && Number.isFinite(last) &&
          first <= end + 30 * 60_000 && last >= start - 30 * 60_000;
      })
      .map((candidate) => {
        const points = parsePoints(candidate, from, to);
        const first = points[0] ? Date.parse(points[0].observed_at) : Number.NaN;
        const last = points[points.length - 1]
          ? Date.parse(points[points.length - 1].observed_at) : Number.NaN;
        const overlap = Number.isFinite(first) && Number.isFinite(last)
          ? Math.max(0, Math.min(last, end) - Math.max(first, start)) : 0;
        return { points, overlap };
      })
      .sort((a, b) => b.overlap - a.overlap || b.points.length - a.points.length);

    return NextResponse.json(
      { points: matches[0]?.points ?? [], source: "adsb.aero" },
      { headers: { "Cache-Control": "public, max-age=600" } },
    );
  } catch (error) {
    console.warn("ADSB historical archive unavailable", error);
    return empty();
  }
}
