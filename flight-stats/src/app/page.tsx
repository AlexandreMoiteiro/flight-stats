"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  Gauge,
  Moon,
  Plane,
  RefreshCw,
  Search,
  TimerReset,
} from "lucide-react";

import { FlightTrackModal } from "@/components/flight-track-modal";
import type {
  Flight,
  FlightStatsErrorResponse,
  FlightStatsResponse,
} from "@/lib/flight-types";

type ViewKey = "overview" | "logbook";

type Totals = {
  se: number;
  me: number;
  mp: number;
  total: number;
  landDay: number;
  landNight: number;
  night: number;
  ifr: number;
  pic: number;
  copilot: number;
  dual: number;
  instructor: number;
  fstd: number;
};

const LOGBOOK_ROWS = 20;
const FLIGHT_ROWS = 25;

function safe(value: number | null | undefined): number {
  return Number.isFinite(value ?? Number.NaN)
    ? Math.max(0, Math.round(value ?? 0))
    : 0;
}

function hm(minutes: number | null | undefined): string {
  const value = safe(minutes);
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  return hours + ":" + String(mins).padStart(2, "0");
}

function hoursLabel(minutes: number | null | undefined): string {
  const value = safe(minutes);
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  return hours + "h " + String(mins).padStart(2, "0");
}

function displayDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value.slice(0, 10) + "T12:00:00Z");
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function logDate(value: string | null | undefined): string {
  if (!value) return "";
  const parts = value.slice(0, 10).split("-");
  if (parts.length !== 3) return value;
  return parts[2] + "/" + parts[1] + "/" + parts[0].slice(-2);
}

function utcTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return (
    String(date.getUTCHours()).padStart(2, "0") +
    String(date.getUTCMinutes()).padStart(2, "0")
  );
}

function ifrMinutes(flight: Flight): number {
  return (
    safe(flight.single_engine_ifr_minutes) +
    safe(flight.multi_engine_ifr_minutes)
  );
}

function meMinutes(flight: Flight): number {
  return (
    safe(flight.multi_engine_vfr_minutes) +
    safe(flight.multi_engine_ifr_minutes)
  );
}

function isSimulator(flight: Flight): boolean {
  return (
    flight.flight_type === "SIM" ||
    (safe(flight.synthetic_training_minutes) > 0 &&
      safe(flight.total_minutes) === 0)
  );
}

function role(flight: Flight): string {
  if (isSimulator(flight)) return "SIM";
  if (flight.flight_type === "SPIC") return "SPIC";
  if (flight.flight_type === "SOLO") return "SOLO";
  if (flight.flight_type === "DUAL") return "DUAL";
  if (safe(flight.pilot_in_command_minutes) > 0) return "PIC";
  if (safe(flight.dual_minutes) > 0) return "DUAL";
  if (safe(flight.co_pilot_minutes) > 0) return "COP";
  return "—";
}

function icaoType(model: string | null | undefined): string {
  const value = String(model ?? "")
    .toUpperCase()
    .replace(/[–—]/g, "-")
    .trim();

  if (!value) return "";
  if (/P\s*-?\s*2008|P2008JC|P208/.test(value)) return "P208";
  if (/P\s*-?\s*2006T|P06T/.test(value)) return "P06T";
  if (/PA\s*-?\s*28|P28A/.test(value)) return "P28A";
  if (/C\s*152|CESSNA\s*152/.test(value)) return "C152";
  if (/C\s*150|CESSNA\s*150/.test(value)) return "C150";
  if (/C\s*172|CESSNA\s*172/.test(value)) return "C172";
  if (/DA\s*-?\s*40/.test(value)) return "DA40";
  if (/DA\s*-?\s*42/.test(value)) return "DA42";

  return value.replace(/\s+/g, "").replaceAll("-", "");
}

function logbookPicName(flight: Flight): string {
  if (flight.flight_type === "SOLO") return "SELF";
  if (flight.flight_type === "DUAL" || flight.flight_type === "SPIC") {
    return flight.instructor_name || flight.name_of_pilot_in_command || "";
  }

  if (safe(flight.dual_minutes) > 0) {
    return flight.instructor_name || flight.name_of_pilot_in_command || "";
  }

  if (safe(flight.pilot_in_command_minutes) > 0) return "SELF";
  return flight.name_of_pilot_in_command || "";
}

function logbookRemarks(flight: Flight): string {
  const remarks = String(flight.remarks_and_endorsements ?? "").trim();
  if (flight.flight_type !== "SPIC") return remarks;
  if (!remarks) return "*";
  return remarks.includes("*") ? remarks : remarks + " *";
}

function fstdLabel(flight: Flight): string {
  const bits = [flight.fstd_type, flight.fstd_model].filter(Boolean);
  if (bits.length) return bits.join(" · ");
  return flight.type_of_aircraft || flight.registration || "FSTD";
}

function sum(flights: Flight[], pick: (flight: Flight) => number): number {
  return flights.reduce((total, flight) => total + safe(pick(flight)), 0);
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter(Boolean) as string[])).sort((a, b) =>
    a.localeCompare(b),
  );
}

function monthLabel(key: string): string {
  const parts = key.split("-");
  const date = new Date(
    Date.UTC(Number(parts[0]), Number(parts[1]) - 1, 1),
  );
  return new Intl.DateTimeFormat("pt-PT", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function daysSince(value: string | null | undefined): number | null {
  if (!value) return null;
  const date = new Date(value.slice(0, 10) + "T12:00:00Z");
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / 86_400_000),
  );
}

function emptyTotals(): Totals {
  return {
    se: 0,
    me: 0,
    mp: 0,
    total: 0,
    landDay: 0,
    landNight: 0,
    night: 0,
    ifr: 0,
    pic: 0,
    copilot: 0,
    dual: 0,
    instructor: 0,
    fstd: 0,
  };
}

function addTotals(a: Totals, b: Totals): Totals {
  return {
    se: a.se + b.se,
    me: a.me + b.me,
    mp: a.mp + b.mp,
    total: a.total + b.total,
    landDay: a.landDay + b.landDay,
    landNight: a.landNight + b.landNight,
    night: a.night + b.night,
    ifr: a.ifr + b.ifr,
    pic: a.pic + b.pic,
    copilot: a.copilot + b.copilot,
    dual: a.dual + b.dual,
    instructor: a.instructor + b.instructor,
    fstd: a.fstd + b.fstd,
  };
}

function rowTotals(flight: Flight): Totals {
  if (isSimulator(flight)) {
    return {
      ...emptyTotals(),
      fstd: safe(flight.synthetic_training_minutes),
    };
  }

  const se =
    safe(flight.single_engine_vfr_minutes) +
    safe(flight.single_engine_ifr_minutes);
  const me =
    safe(flight.multi_engine_vfr_minutes) +
    safe(flight.multi_engine_ifr_minutes);
  const total = safe(flight.total_minutes);

  return {
    se: se > 0 && me === 0 ? total : 0,
    me: me > 0 && se === 0 ? total : 0,
    mp: safe(flight.multi_pilot_minutes),
    total,
    landDay: Math.max(0, Math.round(flight.landings_day ?? 0)),
    landNight: Math.max(0, Math.round(flight.landings_night ?? 0)),
    night: safe(flight.night_minutes),
    ifr: ifrMinutes(flight),
    pic: safe(flight.pilot_in_command_minutes),
    copilot: safe(flight.co_pilot_minutes),
    dual: safe(flight.dual_minutes),
    instructor: safe(flight.flight_instructor_minutes),
    fstd: 0,
  };
}

function totalRows(flights: Flight[]): Totals {
  return flights.reduce(
    (acc, flight) => addTotals(acc, rowTotals(flight)),
    emptyTotals(),
  );
}

function LogDuration({ value }: { value: number }) {
  const minutes = safe(value);
  if (minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const mins = String(minutes % 60).padStart(2, "0");

  return (
    <span className="logbook-duration">
      <span>{hours}</span>
      <span>{mins}</span>
    </span>
  );
}

function TotalsRow({ label, totals }: { label: string; totals: Totals }) {
  return (
    <tr className="logbook-total-row">
      <td colSpan={7} className="logbook-total-label">
        {label}
      </td>
      <td><LogDuration value={totals.se} /></td>
      <td><LogDuration value={totals.me} /></td>
      <td><LogDuration value={totals.mp} /></td>
      <td><LogDuration value={totals.total} /></td>
      <td></td>
      <td>{totals.landDay || ""}</td>
      <td>{totals.landNight || ""}</td>
      <td><LogDuration value={totals.night} /></td>
      <td><LogDuration value={totals.ifr} /></td>
      <td><LogDuration value={totals.pic} /></td>
      <td><LogDuration value={totals.copilot} /></td>
      <td><LogDuration value={totals.dual} /></td>
      <td><LogDuration value={totals.instructor} /></td>
      <td></td>
      <td></td>
      <td><LogDuration value={totals.fstd} /></td>
      <td></td>
    </tr>
  );
}

function Logbook({
  rows,
  previous,
  profileName,
  page,
}: {
  rows: Flight[];
  previous: Flight[];
  profileName: string;
  page: number;
}) {
  const pageTotals = totalRows(rows);
  const previousTotals = totalRows(previous);
  const cumulative = addTotals(pageTotals, previousTotals);
  const padded: Array<Flight | null> = [...rows];

  while (padded.length < LOGBOOK_ROWS) padded.push(null);

  return (
    <div className="logbook-paper">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
            PILOT LOGBOOK / CADERNETA DE VOO · AMC1 FCL.050
          </p>
          <p className="mt-1 text-sm font-semibold text-zinc-950">
            {profileName || "Pilot"}
          </p>
        </div>
        <p className="font-mono text-xs text-zinc-500">Página {page}</p>
      </div>

      <div className="logbook-scroll-inner">
        <table className="logbook-table">
          <thead>
            <tr>
              <th rowSpan={2}>1<br />Data</th>
              <th colSpan={2}>2 · Partida</th>
              <th colSpan={2}>3 · Chegada</th>
              <th colSpan={2}>4 · Aeronave</th>
              <th colSpan={3}>5 · Tempo de piloto</th>
              <th rowSpan={2}>6<br />Tempo total</th>
              <th rowSpan={2}>7<br />Nome(s) PIC</th>
              <th colSpan={2}>8 · Aterragens</th>
              <th colSpan={2}>9 · Condições operacionais</th>
              <th colSpan={4}>10 · Função do piloto</th>
              <th colSpan={3}>11 · Treino sintético</th>
              <th rowSpan={2}>12<br />Observações / endors.</th>
            </tr>
            <tr>
              <th>Local</th>
              <th>UTC</th>
              <th>Local</th>
              <th>UTC</th>
              <th>Tipo ICAO</th>
              <th>Matrícula</th>
              <th>SE</th>
              <th>ME</th>
              <th>MP</th>
              <th>Dia</th>
              <th>Noite</th>
              <th>Noite</th>
              <th>IFR</th>
              <th>PIC</th>
              <th>Co-pilot</th>
              <th>Dual</th>
              <th>Instr.</th>
              <th>Data</th>
              <th>Tipo</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {padded.map((flight, index) => {
              if (!flight) {
                return (
                  <tr className="logbook-entry-row" key={"blank-" + index}>
                    {Array.from({ length: 24 }).map((_, cell) => (
                      <td key={cell}></td>
                    ))}
                  </tr>
                );
              }

              if (isSimulator(flight)) {
                return (
                  <tr className="logbook-entry-row" key={flight.id}>
                    {Array.from({ length: 20 }).map((_, cell) => (
                      <td key={cell}></td>
                    ))}
                    <td>{logDate(flight.date)}</td>
                    <td>{fstdLabel(flight)}</td>
                    <td>
                      <LogDuration
                        value={safe(flight.synthetic_training_minutes)}
                      />
                    </td>
                    <td className="logbook-left">
                      {logbookRemarks(flight)}
                    </td>
                  </tr>
                );
              }

              const totals = rowTotals(flight);

              return (
                <tr className="logbook-entry-row" key={flight.id}>
                  <td>{logDate(flight.date)}</td>
                  <td>{flight.departure_airport_name || ""}</td>
                  <td>{utcTime(flight.off_block)}</td>
                  <td>{flight.arrival_airport_name || ""}</td>
                  <td>{utcTime(flight.on_block)}</td>
                  <td>{icaoType(flight.type_of_aircraft)}</td>
                  <td>{flight.registration || ""}</td>
                  <td><LogDuration value={totals.se} /></td>
                  <td><LogDuration value={totals.me} /></td>
                  <td><LogDuration value={totals.mp} /></td>
                  <td><LogDuration value={totals.total} /></td>
                  {(() => {
                    const picName = logbookPicName(flight);
                    const scale =
                      picName.length > 26
                        ? "0.60em"
                        : picName.length > 21
                          ? "0.68em"
                          : picName.length > 16
                            ? "0.76em"
                            : "0.86em";

                    return (
                      <td
                        className="logbook-left logbook-pic-name"
                        style={{ fontSize: scale }}
                      >
                        {picName}
                      </td>
                    );
                  })()}
                  <td>{totals.landDay || ""}</td>
                  <td>{totals.landNight || ""}</td>
                  <td><LogDuration value={totals.night} /></td>
                  <td><LogDuration value={totals.ifr} /></td>
                  <td><LogDuration value={totals.pic} /></td>
                  <td><LogDuration value={totals.copilot} /></td>
                  <td><LogDuration value={totals.dual} /></td>
                  <td><LogDuration value={totals.instructor} /></td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td className="logbook-left">{logbookRemarks(flight)}</td>
                </tr>
              );
            })}
            <TotalsRow label="TOTAL ESTA PÁGINA" totals={pageTotals} />
            <TotalsRow label="TOTAL PÁGINAS ANTERIORES" totals={previousTotals} />
            <TotalsRow label="TOTAL" totals={cumulative} />
          </tbody>
        </table>
      </div>

    </div>
  );
}

function Card({
  label,
  value,
  detail,
  large = false,
}: {
  label: string;
  value: string;
  detail?: string;
  large?: boolean;
}) {
  return (
    <div
      className={
        "rounded-2xl border border-zinc-200 bg-white " +
        (large ? "px-6 py-5" : "px-5 py-4")
      }
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
        {label}
      </p>
      <p
        className={
          "mt-2 font-semibold tracking-[-0.04em] text-zinc-950 " +
          (large ? "text-4xl" : "text-2xl")
        }
      >
        {value}
      </p>
      {detail ? <p className="mt-1.5 text-xs text-zinc-500">{detail}</p> : null}
    </div>
  );
}

function Tab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition " +
        (active
          ? "bg-zinc-950 text-white"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950")
      }
    >
      {icon}
      {children}
    </button>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex rounded-full bg-zinc-100 px-2 py-1 text-[10px] font-bold text-zinc-600">
      {children}
    </span>
  );
}

export default function Home() {
  const [data, setData] = useState<FlightStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FlightStatsErrorResponse | null>(null);
  const [view, setView] = useState<ViewKey>("overview");
  const [logPage, setLogPage] = useState(1);
  const [flightPage, setFlightPage] = useState(1);
  const [search, setSearch] = useState("");
  const [year, setYear] = useState("all");
  const [aircraft, setAircraft] = useState("all");
  const [registration, setRegistration] = useState("all");
  const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);
  const [printAll, setPrintAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/flights", {
        cache: "no-store",
      });
      const payload = (await response.json()) as
        | FlightStatsResponse
        | FlightStatsErrorResponse;

      if (!response.ok || "error" in payload) {
        throw Object.assign(
          new Error("error" in payload ? payload.error : "Erro ao sincronizar."),
          {
            code: "code" in payload ? payload.code : undefined,
          },
        );
      }

      setData(payload);
    } catch (caught) {
      setError({
        error:
          caught instanceof Error
            ? caught.message
            : "Erro desconhecido ao sincronizar.",
        code:
          caught && typeof caught === "object" && "code" in caught
            ? String(caught.code ?? "")
            : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!printAll) return;

    const finish = () => setPrintAll(false);
    window.addEventListener("afterprint", finish);
    const timer = window.setTimeout(() => window.print(), 120);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", finish);
    };
  }, [printAll]);

  useEffect(() => {
    setFlightPage(1);
  }, [search, year, aircraft, registration]);

  const flights = data?.flights ?? [];
  const profileName = data
    ? [data.profile.firstName, data.profile.lastName].filter(Boolean).join(" ")
    : "";

  const stats = useMemo(() => {
    const realFlights = flights.filter((flight) => !isSimulator(flight));
    const total = sum(realFlights, (flight) => flight.total_minutes);
    const simulator = sum(
      flights,
      (flight) => flight.synthetic_training_minutes,
    );
    const pic = sum(realFlights, (flight) => flight.pilot_in_command_minutes);
    const spic = sum(realFlights, (flight) => flight.spic_minutes ?? 0);
    const dual = sum(realFlights, (flight) => flight.dual_minutes);
    const night = sum(realFlights, (flight) => flight.night_minutes);
    const ifr = sum(realFlights, ifrMinutes);
    const me = sum(realFlights, meMinutes);
    const solo = sum(
      realFlights.filter((flight) => flight.flight_type === "SOLO"),
      (flight) => flight.total_minutes,
    );
    const landings = realFlights.reduce(
      (value, flight) =>
        value +
        Math.max(0, flight.landings_day ?? 0) +
        Math.max(0, flight.landings_night ?? 0),
      0,
    );
    const airports = new Set(
      realFlights
        .flatMap((flight) => [
          flight.departure_airport_name,
          flight.arrival_airport_name,
        ])
        .filter(Boolean),
    );
    const aircraftRegs = new Set(
      realFlights.map((flight) => flight.registration).filter(Boolean),
    );
    const now = new Date();
    const yearKey = String(now.getUTCFullYear());
    const ytd = sum(
      realFlights.filter((flight) => flight.date?.startsWith(yearKey)),
      (flight) => flight.total_minutes,
    );
    const cutoff = new Date(now);
    cutoff.setUTCDate(cutoff.getUTCDate() - 90);
    const last90 = sum(
      realFlights.filter((flight) => {
        if (!flight.date) return false;
        const date = new Date(flight.date.slice(0, 10) + "T12:00:00Z");
        return date >= cutoff;
      }),
      (flight) => flight.total_minutes,
    );
    const average = realFlights.length
      ? Math.round(total / realFlights.length)
      : 0;

    return {
      total,
      simulator,
      experience: total + simulator,
      pic,
      spic,
      dual,
      solo,
      night,
      ifr,
      me,
      landings,
      flightCount: realFlights.length,
      airportCount: airports.size,
      aircraftCount: aircraftRegs.size,
      ytd,
      last90,
      average,
    };
  }, [flights]);

  const monthly = useMemo(() => {
    const map = new Map<
      string,
      { flightMinutes: number; simMinutes: number }
    >();

    for (const flight of flights) {
      if (!flight.date) continue;
      const key = flight.date.slice(0, 7);
      const current = map.get(key) ?? { flightMinutes: 0, simMinutes: 0 };
      current.flightMinutes += safe(flight.total_minutes);
      current.simMinutes += safe(flight.synthetic_training_minutes);
      map.set(key, current);
    }

    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([key, value]) => ({
        key,
        label: monthLabel(key),
        ...value,
        total: value.flightMinutes + value.simMinutes,
      }));
  }, [flights]);

  const maxMonth = Math.max(1, ...monthly.map((item) => item.total));

  const aircraftRows = useMemo(() => {
    const map = new Map<
      string,
      {
        registration: string;
        models: Set<string>;
        icao: Set<string>;
        flights: number;
        minutes: number;
        pic: number;
        ifr: number;
        me: number;
        lastDate: string | null;
      }
    >();

    for (const flight of flights) {
      if (isSimulator(flight)) continue;

      const key = flight.registration || "SEM MATRÍCULA";
      const current =
        map.get(key) || {
          registration: key,
          models: new Set<string>(),
          icao: new Set<string>(),
          flights: 0,
          minutes: 0,
          pic: 0,
          ifr: 0,
          me: 0,
          lastDate: null,
        };

      if (flight.type_of_aircraft) {
        current.models.add(flight.type_of_aircraft);
        current.icao.add(icaoType(flight.type_of_aircraft));
      }
      current.flights += 1;
      current.minutes += safe(flight.total_minutes);
      current.pic += safe(flight.pilot_in_command_minutes);
      current.ifr += ifrMinutes(flight);
      current.me += meMinutes(flight);
      if (!current.lastDate || String(flight.date) > current.lastDate) {
        current.lastDate = flight.date;
      }
      map.set(key, current);
    }

    return [...map.values()].sort((a, b) => b.minutes - a.minutes);
  }, [flights]);

  const typeRows = useMemo(() => {
    const map = new Map<
      string,
      { icao: string; models: Set<string>; minutes: number; flights: number }
    >();

    for (const flight of flights) {
      if (isSimulator(flight)) continue;
      const code = icaoType(flight.type_of_aircraft) || "—";
      const current =
        map.get(code) || {
          icao: code,
          models: new Set<string>(),
          minutes: 0,
          flights: 0,
        };
      if (flight.type_of_aircraft) current.models.add(flight.type_of_aircraft);
      current.minutes += safe(flight.total_minutes);
      current.flights += 1;
      map.set(code, current);
    }

    return [...map.values()].sort((a, b) => b.minutes - a.minutes);
  }, [flights]);

  const options = useMemo(
    () => ({
      years: unique(flights.map((flight) => flight.date?.slice(0, 4))).reverse(),
      aircraft: unique(
        flights
          .filter((flight) => !isSimulator(flight))
          .map((flight) => flight.type_of_aircraft),
      ),
      registrations: unique(
        flights
          .filter((flight) => !isSimulator(flight))
          .map((flight) => flight.registration),
      ),
    }),
    [flights],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return flights.filter((flight) => {
      if (year !== "all" && !flight.date?.startsWith(year)) return false;
      if (aircraft !== "all" && flight.type_of_aircraft !== aircraft) return false;
      if (registration !== "all" && flight.registration !== registration) {
        return false;
      }

      if (!query) return true;

      const text = [
        flight.date,
        flight.departure_airport_name,
        flight.arrival_airport_name,
        flight.type_of_aircraft,
        icaoType(flight.type_of_aircraft),
        flight.registration,
        flight.name_of_pilot_in_command,
        flight.instructor_name,
        flight.remarks_and_endorsements,
        flight.flight_type,
        flight.fstd_type,
        flight.fstd_model,
        role(flight),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return text.includes(query);
    });
  }, [flights, year, aircraft, registration, search]);

  const flightPageCount = Math.max(1, Math.ceil(filtered.length / FLIGHT_ROWS));
  const safeFlightPage = Math.min(flightPage, flightPageCount);
  const visibleFlights = filtered.slice(
    (safeFlightPage - 1) * FLIGHT_ROWS,
    safeFlightPage * FLIGHT_ROWS,
  );

  const chronological = useMemo(
    () =>
      [...flights].sort((a, b) =>
        String(a.off_block ?? a.date ?? "").localeCompare(
          String(b.off_block ?? b.date ?? ""),
        ),
      ),
    [flights],
  );

  const logPageCount = Math.max(
    1,
    Math.ceil(chronological.length / LOGBOOK_ROWS),
  );
  const safeLogPage = Math.min(logPage, logPageCount);
  const logStart = (safeLogPage - 1) * LOGBOOK_ROWS;
  const logRows = chronological.slice(logStart, logStart + LOGBOOK_ROWS);
  const previousLogRows = chronological.slice(0, logStart);

  const latestReal = flights.find((flight) => !isSimulator(flight));
  const latestDays = daysSince(latestReal?.date);

  return (
    <main className="min-h-screen bg-stone-100 text-zinc-950">
      <header className="screen-only sticky top-0 z-30 border-b border-zinc-200/90 bg-stone-100/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Plane size={19} strokeWidth={2.1} />
                <h1 className="text-lg font-semibold tracking-tight">
                  Flight Stats
                </h1>
              </div>
              {data ? (
                <p className="mt-0.5 text-xs text-zinc-500">
                  {profileName}
                  {data.profile.callSign ? " · " + data.profile.callSign : ""}
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPrintAll(true)}
                disabled={!flights.length}
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 disabled:opacity-40"
              >
                <Download size={15} />
                Caderneta PDF
              </button>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-50"
              >
                <RefreshCw
                  size={15}
                  className={loading ? "animate-spin" : ""}
                />
                Atualizar
              </button>
            </div>
          </div>

          <nav className="flex gap-1 overflow-x-auto">
            <Tab
              active={view === "overview"}
              onClick={() => setView("overview")}
              icon={<Gauge size={15} />}
            >
              Flight Stats
            </Tab>
            <Tab
              active={view === "logbook"}
              onClick={() => setView("logbook")}
              icon={<BookOpen size={15} />}
            >
              Caderneta ANAC
            </Tab>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
        {loading && !data ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-sm text-zinc-500">
            A sincronizar com o FlightLogger…
          </div>
        ) : null}

        {error ? (
          <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error.error}
          </div>
        ) : null}

        {data && view === "overview" ? (
          <div className="screen-only space-y-5">
            <section className="grid gap-3 xl:grid-cols-[1.25fr_0.75fr]">
              <Card
                label="Experiência total"
                value={hoursLabel(stats.experience)}
                detail={
                  hoursLabel(stats.total) +
                  " voo real · " +
                  hoursLabel(stats.simulator) +
                  " FSTD"
                }
                large
              />
              <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                <Card
                  label="Este ano"
                  value={hoursLabel(stats.ytd)}
                  detail="voo real"
                />
                <Card
                  label="Últimos 90 dias"
                  value={hoursLabel(stats.last90)}
                  detail="voo real"
                />
                <Card
                  label="Último voo"
                  value={
                    latestDays === null
                      ? "—"
                      : latestDays === 0
                        ? "Hoje"
                        : latestDays + " d"
                  }
                  detail={
                    latestReal?.registration
                      ? latestReal.registration +
                        " · " +
                        icaoType(latestReal.type_of_aircraft)
                      : undefined
                  }
                />
              </div>
            </section>

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
              <Card label="Voo" value={hoursLabel(stats.total)} />
              <Card label="PIC" value={hoursLabel(stats.pic)} />
              <Card label="SPIC" value={hoursLabel(stats.spic)} />
              <Card label="Dual" value={hoursLabel(stats.dual)} />
              <Card label="IFR" value={hoursLabel(stats.ifr)} />
              <Card label="ME" value={hoursLabel(stats.me)} />
              <Card label="Noite" value={hoursLabel(stats.night)} />
              <Card label="FSTD" value={hoursLabel(stats.simulator)} />
            </section>

            <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-2xl border border-zinc-200 bg-white p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold">Atividade mensal</h2>
                    <p className="mt-1 text-xs text-zinc-500">
                      Voo real + treino sintético
                    </p>
                  </div>
                  <span className="text-xs text-zinc-400">últimos 12 meses</span>
                </div>

                <div className="mt-6 flex h-60 items-end gap-2">
                  {monthly.map((item) => {
                    const flightHeight = Math.round(
                      (item.flightMinutes / maxMonth) * 100,
                    );
                    const simHeight = Math.round(
                      (item.simMinutes / maxMonth) * 100,
                    );

                    return (
                      <div
                        key={item.key}
                        className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2"
                      >
                        <span className="text-[10px] font-medium text-zinc-500">
                          {hm(item.total)}
                        </span>
                        <div className="flex h-40 w-full flex-col justify-end overflow-hidden rounded-lg bg-zinc-100 p-1">
                          {item.simMinutes > 0 ? (
                            <div
                              className="w-full rounded-t-md bg-zinc-400"
                              style={{
                                height: Math.max(4, simHeight) + "%",
                              }}
                              title={"FSTD " + hm(item.simMinutes)}
                            />
                          ) : null}
                          {item.flightMinutes > 0 ? (
                            <div
                              className="w-full rounded-md bg-zinc-900"
                              style={{
                                height: Math.max(4, flightHeight) + "%",
                              }}
                              title={"Voo " + hm(item.flightMinutes)}
                            />
                          ) : null}
                        </div>
                        <span className="max-w-full truncate text-[10px] text-zinc-400">
                          {item.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-white p-5">
                <h2 className="text-sm font-semibold">Experiência operacional</h2>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <Card
                    label="Voos"
                    value={String(stats.flightCount)}
                    detail={"média " + hoursLabel(stats.average)}
                  />
                  <Card
                    label="Aterragens"
                    value={String(stats.landings)}
                    detail={stats.airportCount + " aeródromos"}
                  />
                  <Card
                    label="Aeronaves"
                    value={String(stats.aircraftCount)}
                    detail={typeRows.length + " tipos ICAO"}
                  />
                  <Card
                    label="Solo"
                    value={hoursLabel(stats.solo)}
                    detail={
                      stats.total
                        ? Math.round((stats.solo / stats.total) * 100) + "% do voo"
                        : undefined
                    }
                  />
                </div>
              </div>
            </section>

            <section className="grid gap-5 xl:grid-cols-[0.72fr_1.28fr]">
              <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
                <div className="border-b border-zinc-200 px-5 py-4">
                  <h2 className="text-sm font-semibold">Experiência por tipo ICAO</h2>
                </div>
                <div className="divide-y divide-zinc-100">
                  {typeRows.map((row) => (
                    <div
                      key={row.icao}
                      className="grid grid-cols-[70px_1fr_auto] items-center gap-3 px-5 py-3"
                    >
                      <span className="font-mono text-xs font-bold">
                        {row.icao}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-xs text-zinc-600">
                          {[...row.models].join(" / ")}
                        </p>
                        <p className="mt-0.5 text-[10px] text-zinc-400">
                          {row.flights} registos
                        </p>
                      </div>
                      <span className="font-mono text-xs font-semibold">
                        {hm(row.minutes)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
                <div className="border-b border-zinc-200 px-5 py-4">
                  <h2 className="text-sm font-semibold">Aeronaves</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-[780px] w-full text-left text-sm">
                    <thead className="bg-zinc-50 text-[10px] uppercase tracking-wider text-zinc-500">
                      <tr>
                        <th className="px-5 py-3">Matrícula</th>
                        <th className="px-5 py-3">Modelo</th>
                        <th className="px-5 py-3">ICAO</th>
                        <th className="px-5 py-3 text-right">Voos</th>
                        <th className="px-5 py-3 text-right">Tempo</th>
                        <th className="px-5 py-3 text-right">PIC</th>
                        <th className="px-5 py-3 text-right">IFR</th>
                        <th className="px-5 py-3 text-right">Último</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {aircraftRows.map((row) => (
                        <tr key={row.registration}>
                          <td className="px-5 py-3 font-mono text-xs font-semibold">
                            {row.registration}
                          </td>
                          <td className="px-5 py-3">
                            {[...row.models].join(" / ") || "—"}
                          </td>
                          <td className="px-5 py-3 font-mono text-xs font-semibold">
                            {[...row.icao].join(" / ") || "—"}
                          </td>
                          <td className="px-5 py-3 text-right">{row.flights}</td>
                          <td className="px-5 py-3 text-right font-mono text-xs">
                            {hm(row.minutes)}
                          </td>
                          <td className="px-5 py-3 text-right font-mono text-xs">
                            {hm(row.pic)}
                          </td>
                          <td className="px-5 py-3 text-right font-mono text-xs">
                            {hm(row.ifr)}
                          </td>
                          <td className="px-5 py-3 text-right text-xs text-zinc-500">
                            {displayDate(row.lastDate)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <div className="grid gap-2 rounded-2xl border border-zinc-200 bg-white p-4 md:grid-cols-[1.4fr_0.7fr_0.9fr_0.9fr]">
                <label className="flex items-center rounded-xl border border-zinc-200 px-3">
                  <Search size={15} className="text-zinc-400" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Pesquisar voo, matrícula, aeroporto, instrutor…"
                    className="w-full bg-transparent px-3 py-2.5 text-sm outline-none"
                  />
                </label>

                <select
                  value={year}
                  onChange={(event) => setYear(event.target.value)}
                  className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm outline-none"
                >
                  <option value="all">Todos os anos</option>
                  {options.years.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>

                <select
                  value={aircraft}
                  onChange={(event) => setAircraft(event.target.value)}
                  className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm outline-none"
                >
                  <option value="all">Todos os modelos</option>
                  {options.aircraft.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>

                <select
                  value={registration}
                  onChange={(event) => setRegistration(event.target.value)}
                  className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm outline-none"
                >
                  <option value="all">Todas as matrículas</option>
                  {options.registrations.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>

              <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
                <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
                  <div>
                    <h2 className="text-sm font-semibold">Voos e FSTD</h2>
                    <p className="mt-1 text-xs text-zinc-500">
                      {filtered.length} registos · clica num voo para abrir a trajetória ADS-B
                    </p>
                  </div>
                  <p className="text-xs text-zinc-500">
                    Página {safeFlightPage} / {flightPageCount}
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-[1160px] w-full text-left text-sm">
                    <thead className="bg-zinc-50 text-[10px] uppercase tracking-wider text-zinc-500">
                      <tr>
                        <th className="px-4 py-3">Data</th>
                        <th className="px-4 py-3">Rota</th>
                        <th className="px-4 py-3">Aeronave / FSTD</th>
                        <th className="px-4 py-3">Função</th>
                        <th className="px-4 py-3">PIC / Instrutor</th>
                        <th className="px-4 py-3 text-right">Total</th>
                        <th className="px-4 py-3 text-right">PIC</th>
                        <th className="px-4 py-3 text-right">SPIC</th>
                        <th className="px-4 py-3 text-right">Dual</th>
                        <th className="px-4 py-3 text-right">IFR</th>
                        <th className="px-4 py-3 text-right">Noite</th>
                        <th className="px-4 py-3 text-right">LDG</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {visibleFlights.map((flight) => (
                        <tr
                          key={flight.id}
                          role={isSimulator(flight) ? undefined : "button"}
                          tabIndex={isSimulator(flight) ? undefined : 0}
                          onClick={() => {
                            if (!isSimulator(flight)) setSelectedFlight(flight);
                          }}
                          onKeyDown={(event) => {
                            if (
                              !isSimulator(flight) &&
                              (event.key === "Enter" || event.key === " ")
                            ) {
                              event.preventDefault();
                              setSelectedFlight(flight);
                            }
                          }}
                          className={
                            "hover:bg-zinc-50/70 " +
                            (isSimulator(flight)
                              ? ""
                              : "cursor-pointer focus-within:bg-zinc-50 focus:outline-none")
                          }
                        >
                          <td className="px-4 py-3 text-xs text-zinc-600">
                            {displayDate(flight.date)}
                          </td>
                          <td className="px-4 py-3 font-medium">
                            {isSimulator(flight)
                              ? "FSTD"
                              : (flight.departure_airport_name || "—") +
                                " → " +
                                (flight.arrival_airport_name || "—")}
                          </td>
                          <td className="px-4 py-3">
                            {isSimulator(flight) ? (
                              <>
                                <p>{fstdLabel(flight)}</p>
                                <p className="font-mono text-[11px] text-zinc-500">
                                  {flight.registration || "—"}
                                </p>
                              </>
                            ) : (
                              <>
                                <p>
                                  {flight.type_of_aircraft || "Sem modelo"} ·{" "}
                                  <span className="font-mono text-xs font-semibold">
                                    {icaoType(flight.type_of_aircraft)}
                                  </span>
                                </p>
                                <p className="font-mono text-[11px] text-zinc-500">
                                  {flight.registration || "—"}
                                </p>
                              </>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Badge>{role(flight)}</Badge>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {isSimulator(flight)
                              ? flight.instructor_name || "—"
                              : logbookPicName(flight) || "—"}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs font-semibold">
                            {hm(
                              isSimulator(flight)
                                ? flight.synthetic_training_minutes
                                : flight.total_minutes,
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs">
                            {hm(flight.pilot_in_command_minutes)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs">
                            {hm(flight.spic_minutes)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs">
                            {hm(flight.dual_minutes)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs">
                            {hm(ifrMinutes(flight))}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs">
                            {hm(flight.night_minutes)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {(flight.landings_day ?? 0) +
                              (flight.landings_night ?? 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-3">
                  <button
                    type="button"
                    onClick={() =>
                      setFlightPage((value) => Math.max(1, value - 1))
                    }
                    disabled={safeFlightPage <= 1}
                    className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-semibold disabled:opacity-30"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setFlightPage((value) =>
                        Math.min(flightPageCount, value + 1),
                      )
                    }
                    disabled={safeFlightPage >= flightPageCount}
                    className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-semibold disabled:opacity-30"
                  >
                    Seguinte
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : null}

        {data && view === "logbook" ? (
          <div>
            <div className="screen-only mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Caderneta ANAC / FCL.050</h2>
                <p className="mt-1 text-xs text-zinc-500">
                  {chronological.length} registos · {LOGBOOK_ROWS} por página
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setLogPage((value) => Math.max(1, value - 1))}
                  disabled={safeLogPage <= 1}
                  className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-30"
                >
                  <ChevronLeft size={14} />
                  Anterior
                </button>
                <span className="min-w-24 text-center font-mono text-xs text-zinc-600">
                  {safeLogPage} / {logPageCount}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setLogPage((value) => Math.min(logPageCount, value + 1))
                  }
                  disabled={safeLogPage >= logPageCount}
                  className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-30"
                >
                  Seguinte
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>

            <div className="logbook-scroll">
              <Logbook
                rows={logRows}
                previous={previousLogRows}
                profileName={profileName}
                page={safeLogPage}
              />
            </div>
          </div>
        ) : null}
      </div>

      {printAll ? (
        <div className="print-logbook-book" aria-hidden="true">
          {Array.from({ length: logPageCount }).map((_, index) => {
            const start = index * LOGBOOK_ROWS;
            const rows = chronological.slice(start, start + LOGBOOK_ROWS);
            const previous = chronological.slice(0, start);

            return (
              <Logbook
                key={"print-page-" + index}
                rows={rows}
                previous={previous}
                profileName={profileName}
                page={index + 1}
              />
            );
          })}
        </div>
      ) : null}

      {selectedFlight ? (
        <FlightTrackModal
          flight={selectedFlight}
          onClose={() => setSelectedFlight(null)}
        />
      ) : null}
    </main>
  );
}
