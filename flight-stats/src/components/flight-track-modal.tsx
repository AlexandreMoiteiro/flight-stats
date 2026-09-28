"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, MapPinned, Navigation, Plane, X } from "lucide-react";

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
  callsign: string | null;
  icao_hex: string | null;
  source: string | null;
};

type TrackRef = {
  flight_id: string;
  registration: string;
  provider: string;
  provider_record_id: string | null;
  callsign: string | null;
  view_url: string | null;
  source_kind: string;
  track_start: string | null;
  track_end: string | null;
  point_count: number;
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
    const gapMinutes = pointGapMinutes(previous, current);
    const distanceNm = haversineNm(previous, current);
    const impliedSpeed =
      gapMinutes > 0 ? distanceNm / (gapMinutes / 60) : Number.POSITIVE_INFINITY;
    const shouldSplit = gapMinutes > 2.5 || impliedSpeed > 300;

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
        <span>© OpenStreetMap contributors · fontes ADS-B identificadas no detalhe</span>
      </div>
    </div>
  );
}

export function FlightTrackModal({ flight, onClose }: Props) {
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [trackRef, setTrackRef] = useState<TrackRef | null>(null);

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

      const { data: refData } = await supabase
        .from("flight_stats_track_refs")
        .select(
          "flight_id,registration,provider,provider_record_id,callsign,view_url,source_kind,track_start,track_end,point_count",
        )
        .eq("flight_id", flight.id)
        .maybeSingle();

      if (!active) return;
      setTrackRef((refData as TrackRef | null) ?? null);

      const direct = await supabase
        .from("flight_stats_adsb_points")
        .select(
          "observed_at,lat,lon,altitude_ft,ground_speed_kt,track_deg,vertical_rate_fpm,callsign,icao_hex,source",
        )
        .eq("flight_id", flight.id)
        .order("observed_at", { ascending: true })
        .limit(4000);

      let data = direct.data;
      let error = direct.error;

      if (!error && (!data || data.length === 0)) {
        const start = new Date(flight.off_block);
        const end = new Date(flight.on_block);

        // Historical providers often detect takeoff/landing outside the
        // FlightLogger booking/block timestamps, so use a wider discovery
        // window only as fallback. Flight-specific points always win.
        start.setMinutes(start.getMinutes() - 45);
        end.setMinutes(end.getMinutes() + 45);

        const fallback = await supabase
          .from("flight_stats_adsb_points")
          .select(
            "observed_at,lat,lon,altitude_ft,ground_speed_kt,track_deg,vertical_rate_fpm,callsign,icao_hex,source",
          )
          .eq("registration", flight.registration.toUpperCase())
          .gte("observed_at", start.toISOString())
          .lte("observed_at", end.toISOString())
          .order("observed_at", { ascending: true })
          .limit(4000);

        data = fallback.data;
        error = fallback.error;
      }

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
            callsign: String(point.callsign ?? "").trim() || null,
            icao_hex: String(point.icao_hex ?? "").trim().toUpperCase() || null,
            source: String(point.source ?? "").trim() || null,
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
    let observedMinutes = 0;

    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const gapMinutes = pointGapMinutes(previous, current);
      const distanceNm = haversineNm(previous, current);
      const impliedSpeed =
        gapMinutes > 0
          ? distanceNm / (gapMinutes / 60)
          : Number.POSITIVE_INFINITY;
      const connected = gapMinutes <= 2.5 && impliedSpeed <= 300;

      if (connected) {
        distance += distanceNm;
        observedMinutes += gapMinutes;
      }
    }

    const altitudes = points
      .map((point) => point.altitude_ft)
      .filter((value): value is number => value !== null);
    const speeds = points
      .map((point) => point.ground_speed_kt)
      .filter((value): value is number => value !== null);
    const callsigns = Array.from(
      new Set(points.map((point) => point.callsign).filter(Boolean) as string[]),
    );
    const hexes = Array.from(
      new Set(points.map((point) => point.icao_hex).filter(Boolean) as string[]),
    );
    const sources = Array.from(
      new Set(points.map((point) => point.source).filter(Boolean) as string[]),
    );

    const blockMinutes =
      flight.off_block && flight.on_block
        ? Math.max(
            0,
            (new Date(flight.on_block).getTime() -
              new Date(flight.off_block).getTime()) /
              60_000,
          )
        : 0;

    const coverage =
      blockMinutes > 0
        ? Math.min(100, Math.round((observedMinutes / blockMinutes) * 100))
        : null;

    return {
      distance,
      maxAltitude: altitudes.length ? Math.max(...altitudes) : null,
      maxSpeed: speeds.length ? Math.max(...speeds) : null,
      first: points[0].observed_at,
      last: points[points.length - 1].observed_at,
      coverage,
      callsigns,
      hexes,
      sources,
    };
  }, [points, flight]);

  const isAttachedProviderTrack =
    trackRef?.source_kind === "flightlogger-attached-kml";

  const hasUsableTrack =
    points.length >= 2 &&
    (isAttachedProviderTrack ||
      ((trackStats?.coverage ?? 0) >= 70 && points.length >= 10) ||
      ((trackStats?.coverage ?? 0) >= 35 && points.length >= 30));


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
          ) : hasUsableTrack ? (
            <>
              <MapView points={points} />

              {trackRef ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-sky-700">
                      Track associado ao voo
                    </p>
                    <p className="mt-1 text-xs text-sky-950">
                      {trackRef.provider}
                      {trackRef.callsign ? " · " + trackRef.callsign : ""}
                      {trackRef.provider_record_id
                        ? " · ID " + trackRef.provider_record_id
                        : ""}
                    </p>
                  </div>
                  {trackRef.view_url ? (
                    <a
                      href={trackRef.view_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-sky-300 bg-white px-3 py-2 text-xs font-semibold text-sky-800 transition hover:border-sky-400"
                    >
                      Abrir fonte
                      <ExternalLink size={13} />
                    </a>
                  ) : null}
                </div>
              ) : null}

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
          ) : points.length >= 2 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-7 text-center">
              <AlertTriangle className="mx-auto text-amber-600" size={28} />
              <p className="mt-3 text-sm font-semibold text-amber-950">
                Fragmento ADS-B demasiado incompleto para mostrar como trajetória
              </p>
              <p className="mx-auto mt-2 max-w-2xl text-xs leading-5 text-amber-800">
                Foram encontrados {points.length} pontos entre{" "}
                {timeLabel(trackStats?.first)} e {timeLabel(trackStats?.last)} UTC,
                cobrindo aproximadamente {trackStats?.coverage ?? 0}% do block.
                Como estes pontos não estão associados diretamente a um track
                guardado para este voo, o mapa fica oculto em vez de apresentar
                um fragmento como se fosse a trajetória completa.
              </p>
              <div className="mx-auto mt-4 flex max-w-xl flex-wrap justify-center gap-2 text-[11px] text-amber-900">
                {trackStats?.callsigns.length ? (
                  <span className="rounded-full border border-amber-300 bg-white/60 px-2.5 py-1">
                    Callsign: {trackStats.callsigns.join(" / ")}
                  </span>
                ) : null}
                {trackStats?.hexes.length ? (
                  <span className="rounded-full border border-amber-300 bg-white/60 px-2.5 py-1">
                    Mode-S: {trackStats.hexes.join(" / ")}
                  </span>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-zinc-200 bg-white p-7 text-center">
              <MapPinned className="mx-auto text-zinc-400" size={28} />
              <p className="mt-3 text-sm font-semibold">
                Sem trajetória ADS-B disponível para este voo
              </p>
              <p className="mx-auto mt-2 max-w-xl text-xs leading-5 text-zinc-500">
                O voo foi procurado também nas fontes históricas disponíveis.
                Não existem pontos ADS-B utilizáveis para a janela deste voo,
                ou a cobertura nessa zona/altura foi insuficiente.
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
                {isAttachedProviderTrack
                  ? "Track guardado no FlightLogger"
                  : hasUsableTrack
                    ? "Track com cobertura suficiente"
                    : points.length
                      ? "Apenas fragmento parcial"
                      : "Sem track"}
              </p>
              <p className="mt-1 text-[11px] text-zinc-500">
                {trackStats?.callsigns.length
                  ? trackStats.callsigns.join(" / ") + " · "
                  : ""}
                {trackStats?.hexes.length
                  ? trackStats.hexes.join(" / ") + " · "
                  : ""}
                {trackStats?.coverage !== null && trackStats
                  ? trackStats.coverage + "% cobertura"
                  : "sem cobertura"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
