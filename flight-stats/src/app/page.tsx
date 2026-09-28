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
type FlightKind = "all" | "flight" | "sim";

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

  if (isSimulator(flight)) {
    const hasMcc = String(flight.fstd_type ?? "")
      .toUpperCase()
      .includes("MCC");
    if (!hasMcc) return remarks;
    if (!remarks) return "MCC";
    return /\bMCC\b/i.test(remarks) ? remarks : remarks + " · MCC";
  }

  if (flight.flight_type !== "SPIC") return remarks;
  if (!remarks) return "*";
  return remarks.includes("*") ? remarks : remarks + " *";
}

function logbookFstdType(flight: Flight): string {
  const value = String(flight.fstd_type ?? "").toUpperCase().trim();

  if (/FNPT\s*II/.test(value)) return "FNPT II";
  if (/FNPT\s*I/.test(value)) return "FNPT I";

  return value.replace(/\s*\/\s*MCC\b/g, "").trim() || "FSTD";
}

function fstdLabel(flight: Flight): string {
  const bits = [logbookFstdType(flight), flight.fstd_model].filter(Boolean);
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
                    <td>{logbookFstdType(flight)}</td>
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

function SynopticMotif() {
  return (
    <svg
      className="fs-synoptic-motif"
      viewBox="0 0 900 420"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="fs-heat-spectrum" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#f3d43b" />
          <stop offset="17%" stopColor="#79d85d" />
          <stop offset="36%" stopColor="#39c6b8" />
          <stop offset="54%" stopColor="#42a9e7" />
          <stop offset="72%" stopColor="#6e75df" />
          <stop offset="88%" stopColor="#8d53c7" />
          <stop offset="100%" stopColor="#4ec88d" />
        </linearGradient>
        <radialGradient id="fs-scan-field" cx="52%" cy="42%" r="62%">
          <stop offset="0%" stopColor="#78e075" stopOpacity="0.9" />
          <stop offset="35%" stopColor="#4bbbd7" stopOpacity="0.78" />
          <stop offset="68%" stopColor="#736cd5" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#2c2e32" stopOpacity="0.08" />
        </radialGradient>
        <filter id="fs-soft-grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            seed="7"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="table" tableValues="0 0.12" />
          </feComponentTransfer>
        </filter>
      </defs>

      <g className="fs-topography-lines">
        <path d="M42 340 C120 292 155 210 233 171 C322 126 427 145 481 91 C528 44 631 33 713 84 C780 126 810 202 859 239" />
        <path d="M27 368 C116 318 156 241 244 198 C327 158 425 176 497 119 C563 67 650 64 722 108 C789 150 816 216 873 255" />
        <path d="M77 392 C145 349 188 281 264 242 C334 206 424 214 507 155 C574 107 654 102 716 139 C772 173 811 229 878 273" />
        <path d="M142 411 C194 372 236 322 295 286 C362 246 437 252 520 196 C585 151 645 145 699 175 C749 203 789 249 851 294" />
        <path d="M229 418 C265 388 306 350 353 319 C408 283 463 285 532 239 C587 202 637 196 680 219 C721 242 754 278 807 320" />

        <path d="M154 88 C202 40 280 18 345 39 C405 59 434 104 476 126" />
        <path d="M184 111 C225 72 284 55 337 70 C385 84 417 117 454 139" />
        <path d="M220 132 C254 104 297 95 335 104 C369 112 398 135 431 155" />

        <path d="M660 338 C704 304 746 294 783 310 C819 326 841 361 872 386" />
        <path d="M690 362 C727 337 758 332 789 345 C817 357 839 381 862 399" />
      </g>

      <g className="fs-tissue-bands">
        <path d="M76 75 C117 112 133 157 123 208 C115 248 87 285 83 325" />
        <path d="M105 61 C151 101 169 153 159 213 C151 260 121 302 118 346" />
        <path d="M135 55 C183 93 205 149 197 215 C191 269 161 312 159 361" />
      </g>

      <rect x="0" y="0" width="900" height="420" filter="url(#fs-soft-grain)" opacity="0.32" />
    </svg>
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
    <div className={"fs-stat-card " + (large ? "fs-stat-card--large" : "")}>
      <p className="fs-stat-label">{label}</p>
      <p className="fs-stat-value">{value}</p>
      {detail ? <p className="fs-stat-detail">{detail}</p> : null}
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
      className={"fs-tab " + (active ? "fs-tab--active" : "")}
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
  const [kind, setKind] = useState<FlightKind>("all");
  const [typeCode, setTypeCode] = useState("all");
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
  }, [search, year, aircraft, registration, kind, typeCode]);

  const jumpToLog = () => {
    window.requestAnimationFrame(() =>
      document.getElementById("flight-log")?.scrollIntoView({ behavior: "smooth" }),
    );
  };

  const clearFilters = () => {
    setSearch("");
    setYear("all");
    setAircraft("all");
    setRegistration("all");
    setKind("all");
    setTypeCode("all");
  };

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
      if (kind === "flight" && isSimulator(flight)) return false;
      if (kind === "sim" && !isSimulator(flight)) return false;
      if (typeCode !== "all" && icaoType(flight.type_of_aircraft) !== typeCode) return false;
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
  }, [flights, year, aircraft, registration, search, kind, typeCode]);

  const hasFilters = Boolean(search || year !== "all" || aircraft !== "all" || registration !== "all" || kind !== "all" || typeCode !== "all");

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
    <main className="fs-app min-h-screen text-slate-950">
      <header className="screen-only fs-header">
        <div className="mx-auto max-w-[1840px] px-4 sm:px-6 lg:px-8">
          <div className="flex min-h-[72px] flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="fs-logo-mark">
                <Plane size={19} strokeWidth={2.2} />
              </div>
              <div>
                <h1 className="text-[20px] font-semibold tracking-[-0.035em] text-slate-950">
                  Flight Stats
                </h1>
                {data ? (
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {profileName}
                    {data.profile.callSign ? " · " + data.profile.callSign : ""}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPrintAll(true)}
                disabled={!flights.length}
                className="fs-button fs-button--ghost"
              >
                <Download size={14} />
                Caderneta PDF
              </button>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="fs-button fs-button--primary"
              >
                <RefreshCw
                  size={14}
                  className={loading ? "animate-spin" : ""}
                />
                Atualizar
              </button>
            </div>
          </div>

          <nav className="fs-main-tabs" aria-label="Vistas">
            <Tab
              active={view === "overview"}
              onClick={() => setView("overview")}
              icon={<Gauge size={14} />}
            >
              Flight Stats
            </Tab>
            <Tab
              active={view === "logbook"}
              onClick={() => setView("logbook")}
              icon={<BookOpen size={14} />}
            >
              Caderneta ANAC
            </Tab>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[1840px] px-4 py-5 sm:px-6 lg:px-8">
        {loading && !data ? (
          <div className="fs-notice" role="status">
            A sincronizar com o FlightLogger…
          </div>
        ) : null}

        {error ? (
          <div className="fs-notice fs-notice--error" role="alert">
            {error.error}
          </div>
        ) : null}

        {data && view === "overview" ? (
          <div className="screen-only fs-flow">
            <section className="fs-hero">
              <SynopticMotif />
              <div className="fs-ofp-titlebar">
                <div>
                  <span>FLIGHT EXPERIENCE</span>
                  <strong>PERSONAL OPERATIONS RECORD</strong>
                </div>
                <div>
                  <span>PILOT</span>
                  <strong>{profileName || "—"}</strong>
                </div>
                <div>
                  <span>LAST SYNC / UTC</span>
                  <strong>
                    {displayDate(data.syncedAt)} {utcTime(data.syncedAt)}Z
                  </strong>
                </div>
              </div>

              <div className="fs-hero-main">
                <div>
                  <p className="fs-eyebrow">TOTAL EXPERIENCE</p>
                  <p className="fs-total-time">{hoursLabel(stats.experience)}</p>
                  <p className="fs-total-detail">
                    {hoursLabel(stats.total)} voo real
                    <span>•</span>
                    {hoursLabel(stats.simulator)} FSTD
                    <span>•</span>
                    {stats.flightCount} voos
                  </p>
                </div>

                <div className="fs-hero-side">
                  <div className="fs-hero-scan" aria-hidden="true">
                    <span />
                  </div>
                  <div>
                    <span>ESTE ANO</span>
                    <strong>{hoursLabel(stats.ytd)}</strong>
                  </div>
                  <div>
                    <span>ÚLTIMOS 90 DIAS</span>
                    <strong>{hoursLabel(stats.last90)}</strong>
                  </div>
                  <div>
                    <span>RECÊNCIA</span>
                    <strong>
                      {latestDays === null
                        ? "—"
                        : latestDays === 0
                          ? "Hoje"
                          : latestDays + " d"}
                    </strong>
                    <small>
                      {latestReal?.registration
                        ? latestReal.registration +
                          " · " +
                          icaoType(latestReal.type_of_aircraft)
                        : "sem voo"}
                    </small>
                  </div>
                </div>
              </div>

              <div className="fs-time-ribbon">
                {[
                  ["PIC", stats.pic],
                  ["SPIC", stats.spic],
                  ["DUAL", stats.dual],
                  ["IFR", stats.ifr],
                  ["ME", stats.me],
                  ["NOITE", stats.night],
                  ["SOLO", stats.solo],
                  ["FSTD", stats.simulator],
                ].map(([label, value]) => (
                  <div key={String(label)} className="fs-ribbon-cell">
                    <span>{label}</span>
                    <strong>{hoursLabel(Number(value))}</strong>
                  </div>
                ))}
              </div>
            </section>

            <nav className="fs-section-nav" aria-label="Secções do Flight Stats">
              <span>EXPLORAR / 01—04</span>
              <a href="#activity">Atividade</a>
              <a href="#flight-log">Voos e FSTD</a>
              <a href="#aircraft-types">Tipos</a>
              <a href="#fleet">Aeronaves</a>
            </nav>

            <section id="activity" className="fs-section fs-flow-split fs-flow-split--activity">
              <div className="fs-panel">
                <div className="fs-panel-heading">
                  <div>
                    <p className="fs-eyebrow fs-eyebrow--dark">ACTIVITY</p>
                    <h2>Atividade de voo</h2>
                  </div>
                  <span>12 meses</span>
                </div>

                <div className="fs-chart">
                  {monthly.map((item) => {
                    const flightHeight = Math.round(
                      (item.flightMinutes / maxMonth) * 100,
                    );
                    const simHeight = Math.round(
                      (item.simMinutes / maxMonth) * 100,
                    );

                    return (
                      <div key={item.key} className="fs-chart-item">
                        <span className="fs-chart-total">{hm(item.total)}</span>
                        <div className="fs-chart-track">
                          {item.simMinutes > 0 ? (
                            <div
                              className="fs-chart-bar fs-chart-bar--sim"
                              style={{ height: Math.max(3, simHeight) + "%" }}
                              title={"FSTD " + hm(item.simMinutes)}
                            />
                          ) : null}
                          {item.flightMinutes > 0 ? (
                            <div
                              className="fs-chart-bar fs-chart-bar--flight"
                              style={{ height: Math.max(3, flightHeight) + "%" }}
                              title={"Voo " + hm(item.flightMinutes)}
                            />
                          ) : null}
                        </div>
                        <span className="fs-chart-month">{item.label}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="fs-chart-legend">
                  <span><i className="fs-dot fs-dot--flight" /> Voo real</span>
                  <span><i className="fs-dot fs-dot--sim" /> FSTD</span>
                </div>
              </div>

              <div className="fs-panel">
                <div className="fs-panel-heading">
                  <div>
                    <p className="fs-eyebrow fs-eyebrow--dark">PROFILE</p>
                    <h2>Perfil operacional</h2>
                  </div>
                </div>

                <div className="fs-profile-list">
                  {[
                    ["PIC", stats.pic],
                    ["SPIC", stats.spic],
                    ["Dual", stats.dual],
                    ["IFR", stats.ifr],
                    ["Multi-engine", stats.me],
                    ["Noite", stats.night],
                  ].map(([label, value]) => {
                    const minutes = Number(value);
                    const pct = stats.total
                      ? Math.min(100, Math.round((minutes / stats.total) * 100))
                      : 0;

                    return (
                      <div key={String(label)} className="fs-profile-row">
                        <div className="flex items-center justify-between gap-3">
                          <span>{label}</span>
                          <strong>{hoursLabel(minutes)}</strong>
                        </div>
                        <div className="fs-profile-track">
                          <div style={{ width: Math.max(2, pct) + "%" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="fs-quick-grid">
                  <div>
                    <span>VOOS</span>
                    <strong>{stats.flightCount}</strong>
                  </div>
                  <div>
                    <span>ATER.</span>
                    <strong>{stats.landings}</strong>
                  </div>
                  <div>
                    <span>AERONAVES</span>
                    <strong>{stats.aircraftCount}</strong>
                  </div>
                  <div>
                    <span>AERÓDROMOS</span>
                    <strong>{stats.airportCount}</strong>
                  </div>
                </div>
              </div>
            </section>

            <section id="flight-log" className="fs-section fs-panel overflow-hidden">
              <div className="fs-panel-heading">
                <div>
                  <p className="fs-eyebrow fs-eyebrow--dark">LOG</p>
                  <h2>Voos e FSTD</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {filtered.length} de {flights.length} registos · abre um voo para ver a trajetória
                  </p>
                </div>
                <span>Página {safeFlightPage} / {flightPageCount}</span>
              </div>

              <div className="fs-filters">
                <label className="fs-search" aria-label="Pesquisar registos">
                  <Search size={15} />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Pesquisar voo, matrícula, aeroporto, instrutor…"
                  />
                </label>

                <select aria-label="Filtrar por ano" value={year} onChange={(event) => setYear(event.target.value)}>
                  <option value="all">Todos os anos</option>
                  {options.years.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>

                <select aria-label="Filtrar por modelo" value={aircraft} onChange={(event) => { setAircraft(event.target.value); setTypeCode("all"); }}>
                  <option value="all">Todos os modelos</option>
                  {options.aircraft.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>

                <select
                  aria-label="Filtrar por matrícula"
                  value={registration}
                  onChange={(event) => setRegistration(event.target.value)}
                >
                  <option value="all">Todas as matrículas</option>
                  {options.registrations.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
                <div className="fs-filter-footer">
                  <div className="fs-kind-switch" aria-label="Tipo de registo">
                    {([["all", "Todos"], ["flight", "Voos"], ["sim", "FSTD"]] as const).map(([value, label]) => (
                      <button type="button" key={value} className={kind === value ? "is-active" : ""} aria-pressed={kind === value} onClick={() => setKind(value)}>{label}</button>
                    ))}
                  </div>
                  {hasFilters ? <button type="button" className="fs-clear-filters" onClick={clearFilters}>Limpar filtros</button> : null}
                </div>
              </div>

              {typeCode !== "all" ? <p className="fs-filter-context">TIPO ICAO / {typeCode} <button type="button" onClick={() => setTypeCode("all")}>Remover ×</button></p> : null}

              {filtered.length === 0 ? <div className="fs-empty">Não há registos para estes filtros. <button type="button" onClick={clearFilters}>Mostrar todos</button></div> : null}
              <div className="overflow-x-auto fs-flight-table-wrap">
                <table className="fs-table fs-flight-table min-w-[1160px] w-full">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Rota</th>
                      <th>Aeronave / FSTD</th>
                      <th>Função</th>
                      <th>PIC / Instrutor</th>
                      <th className="text-right">Total</th>
                      <th className="text-right">PIC</th>
                      <th className="text-right">SPIC</th>
                      <th className="text-right">Dual</th>
                      <th className="text-right">IFR</th>
                      <th className="text-right">Noite</th>
                      <th className="text-right">LDG</th>
                    </tr>
                  </thead>
                  <tbody>
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
                        className={isSimulator(flight) ? "" : "fs-flight-row"}
                      >
                        <td className="text-xs text-slate-600">{displayDate(flight.date)}</td>
                        <td className="font-medium">
                          {isSimulator(flight)
                            ? "FSTD"
                            : (flight.departure_airport_name || "—") +
                              " → " +
                              (flight.arrival_airport_name || "—")}
                        </td>
                        <td>
                          {isSimulator(flight) ? (
                            <>
                              <p>{fstdLabel(flight)}</p>
                              <p className="mt-0.5 font-mono text-[10px] text-slate-400">
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
                              <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                                {flight.registration || "—"}
                              </p>
                            </>
                          )}
                        </td>
                        <td><Badge>{role(flight)}</Badge></td>
                        <td>
                          {isSimulator(flight)
                            ? flight.instructor_name || "—"
                            : logbookPicName(flight) || "—"}
                        </td>
                        <td className="text-right font-mono font-semibold">
                          {hm(
                            isSimulator(flight)
                              ? flight.synthetic_training_minutes
                              : flight.total_minutes,
                          )}
                        </td>
                        <td className="text-right font-mono">{hm(flight.pilot_in_command_minutes)}</td>
                        <td className="text-right font-mono">{hm(flight.spic_minutes)}</td>
                        <td className="text-right font-mono">{hm(flight.dual_minutes)}</td>
                        <td className="text-right font-mono">{hm(ifrMinutes(flight))}</td>
                        <td className="text-right font-mono">{hm(flight.night_minutes)}</td>
                        <td className="text-right">
                          {(flight.landings_day ?? 0) + (flight.landings_night ?? 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="fs-mobile-flights">
                {visibleFlights.map((flight) => {
                  const sim = isSimulator(flight);
                  const content = <><span className="fs-mobile-flight-top"><span>{displayDate(flight.date)}</span><Badge>{role(flight)}</Badge></span><strong>{sim ? "FSTD" : `${flight.departure_airport_name || "—"} → ${flight.arrival_airport_name || "—"}`}</strong><span className="fs-mobile-flight-bottom"><span>{sim ? fstdLabel(flight) : `${icaoType(flight.type_of_aircraft)} · ${flight.registration || "—"}`}</span><b>{hm(sim ? flight.synthetic_training_minutes : flight.total_minutes)}</b></span></>;
                  return sim ? <div className="fs-mobile-flight" key={flight.id}>{content}</div> : <button type="button" className="fs-mobile-flight" key={flight.id} onClick={() => setSelectedFlight(flight)} aria-label={`Abrir trajetória de ${displayDate(flight.date)}, ${flight.departure_airport_name || "—"} para ${flight.arrival_airport_name || "—"}`}>{content}</button>;
                })}
              </div>

              <div className="fs-pagination">
                <button
                  type="button"
                  onClick={() => setFlightPage((value) => Math.max(1, value - 1))}
                  disabled={safeFlightPage <= 1}
                >
                  <ChevronLeft size={14} />
                  Anterior
                </button>
                <span>{safeFlightPage} / {flightPageCount}</span>
                <button
                  type="button"
                  onClick={() =>
                    setFlightPage((value) => Math.min(flightPageCount, value + 1))
                  }
                  disabled={safeFlightPage >= flightPageCount}
                >
                  Seguinte
                  <ChevronRight size={14} />
                </button>
              </div>
            </section>
            <section id="aircraft-types" className="fs-section fs-type-section">
              <div className="fs-panel-heading">
                <div>
                  <p className="fs-eyebrow fs-eyebrow--dark">AIRCRAFT TYPES</p>
                  <h2>Experiência por tipo</h2>
                </div>
                <span>{typeRows.length} tipos ICAO</span>
              </div>

              <div className="fs-type-band">
                {typeRows.map((row) => {
                  const maxMinutes = Math.max(1, typeRows[0]?.minutes ?? 1);
                  const width = Math.max(
                    6,
                    Math.round((row.minutes / maxMinutes) * 100),
                  );

                  return (
                    <button type="button" key={row.icao} className="fs-type-band-item" onClick={() => { clearFilters(); setTypeCode(row.icao); setKind("flight"); jumpToLog(); }} aria-label={`Ver voos ${row.icao}`}>
                      <div className="fs-type-band-topline">
                        <div>
                          <strong>{row.icao}</strong>
                          <span>{[...row.models].join(" / ")}</span>
                        </div>
                        <strong className="fs-type-band-time">{hm(row.minutes)}</strong>
                      </div>
                      <div className="fs-type-track">
                        <div style={{ width: width + "%" }} />
                      </div>
                      <p>{row.flights} registos</p>
                    </button>
                  );
                })}
              </div>
            </section>

            <section id="fleet" className="fs-section fs-panel overflow-hidden">
              <div className="fs-panel-heading">
                <div>
                  <p className="fs-eyebrow fs-eyebrow--dark">FLEET</p>
                  <h2>Aeronaves voadas</h2>
                </div>
                <span>{stats.aircraftCount} matrículas</span>
              </div>
              <div className="overflow-x-auto">
                <table className="fs-table fs-fleet-table min-w-[980px] w-full">
                  <thead>
                    <tr>
                      <th>Matrícula</th>
                      <th>Modelo</th>
                      <th>ICAO</th>
                      <th className="text-right">Voos</th>
                      <th className="text-right">Tempo</th>
                      <th className="text-right">PIC</th>
                      <th className="text-right">IFR</th>
                      <th className="text-right">Último</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aircraftRows.map((row) => (
                      <tr key={row.registration}>
                        <td className="font-mono font-semibold"><button type="button" className="fs-ledger-link" onClick={() => { clearFilters(); setRegistration(row.registration); setKind("flight"); jumpToLog(); }} aria-label={`Ver voos de ${row.registration}`}>{row.registration}</button></td>
                        <td>{[...row.models].join(" / ") || "—"}</td>
                        <td className="font-mono text-xs font-semibold">
                          {[...row.icao].join(" / ") || "—"}
                        </td>
                        <td className="text-right">{row.flights}</td>
                        <td className="text-right font-mono text-xs">{hm(row.minutes)}</td>
                        <td className="text-right font-mono text-xs">{hm(row.pic)}</td>
                        <td className="text-right font-mono text-xs">{hm(row.ifr)}</td>
                        <td className="text-right text-xs text-slate-500">
                          {displayDate(row.lastDate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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

            <p className="screen-only fs-logbook-hint">Desliza a caderneta na horizontal para ver todas as colunas. O PDF mantém o formato A4 horizontal.</p>
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
