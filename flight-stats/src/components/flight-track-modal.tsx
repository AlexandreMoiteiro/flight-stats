"use client";

import { useEffect, useMemo, useState } from "react";
import { MapPinned, Navigation, Plane, X } from "lucide-react";

import type { Flight } from "@/lib/flight-types";
import { supabase } from "@/lib/supabase";

type TrackPoint = {
  observed_at: string;
  lat: number;
  lon: number;
  altitude_ft: number | null;
  ground_speed_kt: number | null;
  track_deg: number | null;
  vertical_rate_fpm: number | null;
};

type Props = {
  flight: Flight;
  onClose: () => void;
};

const MAP_WIDTH = 1000;
const MAP_HEIGHT = 500;
const TILE = 256;
const PADDING = 56;

function numberValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timeLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value.slice(0, 10) + "T12:00:00Z");
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function clampLat(lat: number): number {
  return Math.max(-85.05112878, Math.min(85.05112878, lat));
}

function worldPoint(lat: number, lon: number, zoom: number) {
  const scale = TILE * 2 ** zoom;
  const safeLat = clampLat(lat);
  const sin = Math.sin((safeLat * Math.PI) / 180);

  return {
    x: ((lon + 180) / 360) * scale,
    y:
      (0.5 -
        Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) *
      scale,
  };
}

function haversineNm(a: TrackPoint, b: TrackPoint): number {
  const rNm = 3440.065;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;

  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * rNm * Math.asin(Math.sqrt(value));
}

function pointGapMinutes(a: TrackPoint, b: TrackPoint): number {
  return Math.abs(
    new Date(b.observed_at).getTime() - new Date(a.observed_at).getTime(),
  ) / 60_000;
}

function buildSegments(points: TrackPoint[]): TrackPoint[][] {
  if (!points.length) return [];

  const segments: TrackPoint[][] = [[points[0]]];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const shouldSplit =
      pointGapMinutes(previous, current) > 6 ||
      haversineNm(previous, current) > 35;

    if (shouldSplit) segments.push([current]);
    else segments[segments.length - 1].push(current);
  }

  return segments.filter((segment) => segment.length >= 2);
}

function MapView({ points }: { points: TrackPoint[] }) {
  const geometry = useMemo(() => {
    if (!points.length) return null;

    let zoom = 11;

    for (let candidate = 16; candidate >= 2; candidate -= 1) {
      const projected = points.map((point) =>
        worldPoint(point.lat, point.lon, candidate),
      );
      const xs = projected.map((point) => point.x);
      const ys = projected.map((point) => point.y);
      const width = Math.max(...xs) - Math.min(...xs);
      const height = Math.max(...ys) - Math.min(...ys);

      if (
        width <= MAP_WIDTH - PADDING * 2 &&
        height <= MAP_HEIGHT - PADDING * 2
      ) {
        zoom = candidate;
        break;
      }
    }

    const projected = points.map((point) => worldPoint(point.lat, point.lon, zoom));
    const xs = projected.map((point) => point.x);
    const ys = projected.map((point) => point.y);
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
    const left = centerX - MAP_WIDTH / 2;
    const top = centerY - MAP_HEIGHT / 2;

    const startTileX = Math.floor(left / TILE);
    const endTileX = Math.floor((left + MAP_WIDTH) / TILE);
    const startTileY = Math.floor(top / TILE);
    const endTileY = Math.floor((top + MAP_HEIGHT) / TILE);
    const tileCount = 2 ** zoom;
    const tiles: Array<{
      key: string;
      href: string;
      x: number;
      y: number;
    }> = [];

    for (let x = startTileX; x <= endTileX; x += 1) {
      for (let y = startTileY; y <= endTileY; y += 1) {
        if (y < 0 || y >= tileCount) continue;
        const wrappedX = ((x % tileCount) + tileCount) % tileCount;
        tiles.push({
          key: zoom + "-" + x + "-" + y,
          href:
            "https://tile.openstreetmap.org/" +
            zoom +
            "/" +
            wrappedX +
            "/" +
            y +
            ".png",
          x: x * TILE - left,
          y: y * TILE - top,
        });
      }
    }

    const segments = buildSegments(points).map((segment) =>
      segment
        .map((point) => {
          const projectedPoint = worldPoint(point.lat, point.lon, zoom);
          return (
            (projectedPoint.x - left).toFixed(1) +
            "," +
            (projectedPoint.y - top).toFixed(1)
          );
        })
        .join(" "),
    );

    const first = worldPoint(points[0].lat, points[0].lon, zoom);
    const last = worldPoint(
      points[points.length - 1].lat,
      points[points.length - 1].lon,
      zoom,
    );

    return {
      tiles,
      segments,
      first: { x: first.x - left, y: first.y - top },
      last: { x: last.x - left, y: last.y - top },
    };
  }, [points]);

  if (!geometry) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100">
      <svg
        viewBox={"0 0 " + MAP_WIDTH + " " + MAP_HEIGHT}
        className="block h-auto w-full"
        role="img"
        aria-label="Trajetória ADS-B do voo"
      >
        {geometry.tiles.map((tile) => (
          <image
            key={tile.key}
            href={tile.href}
            x={tile.x}
            y={tile.y}
            width={TILE}
            height={TILE}
            preserveAspectRatio="none"
          />
        ))}

        {geometry.segments.map((segment, index) => (
          <polyline
            key={index}
            points={segment}
            fill="none"
            stroke="white"
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.88"
          />
        ))}
        {geometry.segments.map((segment, index) => (
          <polyline
            key={"route-" + index}
            points={segment}
            fill="none"
            stroke="#18181b"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        <circle
          cx={geometry.first.x}
          cy={geometry.first.y}
          r="10"
          fill="white"
          stroke="#18181b"
          strokeWidth="4"
        />
        <circle
          cx={geometry.first.x}
          cy={geometry.first.y}
          r="4"
          fill="#18181b"
        />

        <circle
          cx={geometry.last.x}
          cy={geometry.last.y}
          r="11"
          fill="#18181b"
          stroke="white"
          strokeWidth="4"
        />
      </svg>
      <div className="flex items-center justify-between gap-3 border-t border-zinc-200 bg-white px-3 py-2 text-[10px] text-zinc-500">
        <span>Trajetória ADS-B · linha interrompida quando há perda de cobertura</span>
        <span>© OpenStreetMap contributors · ADS-B © adsb.lol contributors (ODbL)</span>
      </div>
    </div>
  );
}

export function FlightTrackModal({ flight, onClose }: Props) {
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let active = true;

    async function loadTrack() {
      setLoading(true);
      setLoadError(null);

      if (!flight.registration || !flight.off_block || !flight.on_block) {
        setPoints([]);
        setLoading(false);
        return;
      }

      const start = new Date(flight.off_block);
      const end = new Date(flight.on_block);
      start.setMinutes(start.getMinutes() - 12);
      end.setMinutes(end.getMinutes() + 12);

      const { data, error } = await supabase
        .from("flight_stats_adsb_points")
        .select(
          "observed_at,lat,lon,altitude_ft,ground_speed_kt,track_deg,vertical_rate_fpm",
        )
        .eq("registration", flight.registration.toUpperCase())
        .gte("observed_at", start.toISOString())
        .lte("observed_at", end.toISOString())
        .order("observed_at", { ascending: true })
        .limit(2000);

      if (!active) return;

      if (error) {
        setLoadError(error.message);
        setPoints([]);
      } else {
        setPoints(
          (data ?? []).map((point) => ({
            observed_at: String(point.observed_at),
            lat: Number(point.lat),
            lon: Number(point.lon),
            altitude_ft: numberValue(point.altitude_ft),
            ground_speed_kt: numberValue(point.ground_speed_kt),
            track_deg: numberValue(point.track_deg),
            vertical_rate_fpm: numberValue(point.vertical_rate_fpm),
          })),
        );
      }

      setLoading(false);
    }

    void loadTrack();

    return () => {
      active = false;
    };
  }, [flight]);

  const trackStats = useMemo(() => {
    if (!points.length) return null;

    let distance = 0;
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];

      if (
        pointGapMinutes(previous, current) <= 6 &&
        haversineNm(previous, current) <= 35
      ) {
        distance += haversineNm(previous, current);
      }
    }

    const altitudes = points
      .map((point) => point.altitude_ft)
      .filter((value): value is number => value !== null);
    const speeds = points
      .map((point) => point.ground_speed_kt)
      .filter((value): value is number => value !== null);

    return {
      distance,
      maxAltitude: altitudes.length ? Math.max(...altitudes) : null,
      maxSpeed: speeds.length ? Math.max(...speeds) : null,
      first: points[0].observed_at,
      last: points[points.length - 1].observed_at,
    };
  }, [points]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/55 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className="max-h-[94vh] w-full max-w-6xl overflow-y-auto rounded-3xl border border-zinc-200 bg-stone-50 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-zinc-200 bg-stone-50/95 px-5 py-4 backdrop-blur sm:px-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Plane size={18} />
              <h2 className="text-base font-semibold">
                {flight.departure_airport_name || "—"} →{" "}
                {flight.arrival_airport_name || "—"}
              </h2>
              <span className="rounded-full bg-zinc-950 px-2 py-1 font-mono text-[10px] font-bold text-white">
                {flight.registration || "—"}
              </span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {dateLabel(flight.date)} · {timeLabel(flight.off_block)}–
              {timeLabel(flight.on_block)} UTC ·{" "}
              {flight.type_of_aircraft || "Aeronave"}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-zinc-200 bg-white p-2 text-zinc-600 transition hover:text-zinc-950"
            aria-label="Fechar detalhe do voo"
          >
            <X size={17} />
          </button>
        </div>

        <div className="space-y-4 p-5 sm:p-6">
          {loading ? (
            <div className="flex h-72 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-sm text-zinc-500">
              A carregar trajetória ADS-B…
            </div>
          ) : loadError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {loadError}
            </div>
          ) : points.length >= 2 ? (
            <>
              <MapView points={points} />

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    Distância ADS-B
                  </p>
                  <p className="mt-2 text-xl font-semibold">
                    {trackStats?.distance.toFixed(1)} NM
                  </p>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    Altitude máx.
                  </p>
                  <p className="mt-2 text-xl font-semibold">
                    {trackStats?.maxAltitude === null
                      ? "—"
                      : Math.round(trackStats?.maxAltitude ?? 0).toLocaleString(
                          "pt-PT",
                        ) + " ft"}
                  </p>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    GS máx.
                  </p>
                  <p className="mt-2 text-xl font-semibold">
                    {trackStats?.maxSpeed === null
                      ? "—"
                      : Math.round(trackStats?.maxSpeed ?? 0) + " kt"}
                  </p>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    Pontos
                  </p>
                  <p className="mt-2 text-xl font-semibold">{points.length}</p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {timeLabel(trackStats?.first)}–{timeLabel(trackStats?.last)} UTC
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-zinc-200 bg-white p-7 text-center">
              <MapPinned className="mx-auto text-zinc-400" size={28} />
              <p className="mt-3 text-sm font-semibold">
                Ainda não há trajetória ADS-B guardada para este voo
              </p>
              <p className="mx-auto mt-2 max-w-xl text-xs leading-5 text-zinc-500">
                O gravador ADS-B começou agora e guarda novos pontos
                automaticamente. Voos anteriores ao início da gravação podem
                não ter trajetória disponível.
              </p>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="flex items-center gap-2 text-zinc-500">
                <Navigation size={14} />
                <p className="text-[10px] font-bold uppercase tracking-wider">
                  Voo
                </p>
              </div>
              <p className="mt-2 text-sm font-semibold">
                {flight.departure_airport_name || "—"} →{" "}
                {flight.arrival_airport_name || "—"}
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-white p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                PIC / Instrutor
              </p>
              <p className="mt-2 text-sm font-semibold">
                {flight.instructor_name ||
                  flight.name_of_pilot_in_command ||
                  "SELF"}
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-white p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                ADS-B
              </p>
              <p className="mt-2 text-sm font-semibold">
                {points.length ? "Track disponível" : "Sem track"}
              </p>
              <p className="mt-1 text-[11px] text-zinc-500">
                Fonte: adsb.lol · atualização automática
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
