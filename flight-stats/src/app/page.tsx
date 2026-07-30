"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Award,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  Gauge,
  MapPin,
  Monitor,
  Moon,
  Plane,
  PlaneLanding,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  X,
} from "lucide-react";

import type {
  Flight,
  FlightStatsErrorResponse,
  FlightStatsResponse,
} from "@/lib/flight-types";

type PeriodKey = "all" | "ytd" | "90d" | "30d";

type ChartRow = {
  label: string;
  hours?: number;
  flights?: number;
  flightHours?: number;
  simulatorHours?: number;
  value?: number;
  total?: number;
};

type Milestone = {
  targetHours: number;
  remainingMinutes: number;
  progress: number;
};

const chartColors = ["#0284c7", "#0f172a", "#7c3aed", "#94a3b8"];
const PAGE_SIZE = 12;

const periodOptions: Array<{ value: PeriodKey; label: string }> = [
  { value: "all", label: "Tudo" },
  { value: "ytd", label: "Este ano" },
  { value: "90d", label: "90 dias" },
  { value: "30d", label: "30 dias" },
];

function formatMinutes(minutes: number): string {
  const safe = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return `${hours}h${String(mins).padStart(2, "0")}`;
}

function decimalHours(minutes: number): number {
  return Number((minutes / 60).toFixed(1));
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return new Intl.DateTimeFormat("pt-PT", {
    month: "short",
    year: "2-digit",
  }).format(date);
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter(Boolean) as string[])).sort((a, b) =>
    a.localeCompare(b),
  );
}

function sum(flights: Flight[], getValue: (flight: Flight) => number): number {
  return flights.reduce((total, flight) => total + getValue(flight), 0);
}

function daysSince(value: string | null | undefined): number | null {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));
}

function dateMatchesPeriod(dateValue: string | null, period: PeriodKey): boolean {
  if (period === "all") return true;
  if (!dateValue) return false;

  const date = new Date(`${dateValue.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return false;

  const now = new Date();
  if (period === "ytd") return date.getFullYear() === now.getFullYear();

  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (period === "30d" ? 30 : 90));
  return date >= cutoff;
}

function nextMilestone(minutes: number): Milestone {
  const currentHours = Math.max(0, minutes / 60);
  const step = currentHours < 50 ? 10 : 25;
  const targetHours = (Math.floor(currentHours / step) + 1) * step;
  const previousTarget = Math.max(0, targetHours - step);
  const progress = Math.min(
    100,
    Math.max(0, ((currentHours - previousTarget) / step) * 100),
  );

  return {
    targetHours,
    remainingMinutes: Math.max(0, Math.round(targetHours * 60 - minutes)),
    progress,
  };
}

function tooltipStyle() {
  return {
    background: "rgba(255,255,255,0.98)",
    border: "1px solid #e2e8f0",
    borderRadius: "16px",
    color: "#0f172a",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.12)",
  };
}

function flightRole(flight: Flight): string {
  if (flight.synthetic_training_minutes > 0) return "SIM";
  if (flight.pilot_in_command_minutes > 0) return "PIC";
  if (flight.dual_minutes > 0) return "Dual";
  if (flight.co_pilot_minutes > 0) return "Co-pilot";
  return "Voo";
}

function roleClasses(role: string): string {
  if (role === "PIC") return "bg-emerald-50 text-emerald-700 ring-emerald-600/10";
  if (role === "Dual") return "bg-sky-50 text-sky-700 ring-sky-600/10";
  if (role === "SIM") return "bg-violet-50 text-violet-700 ring-violet-600/10";
  return "bg-slate-100 text-slate-600 ring-slate-500/10";
}

function MetricCard({
  label,
  value,
  detail,
  icon,
  accent = false,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <article
      className={`group relative overflow-hidden rounded-[1.6rem] border p-5 shadow-[0_10px_35px_rgba(15,23,42,0.04)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_45px_rgba(15,23,42,0.08)] ${
        accent
          ? "border-sky-200 bg-gradient-to-br from-sky-50 via-white to-white"
          : "border-slate-200/80 bg-white"
      }`}
    >
      {accent ? (
        <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-sky-200/40 blur-2xl" />
      ) : null}
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950">
            {value}
          </p>
        </div>
        <div
          className={`rounded-2xl p-2.5 transition group-hover:scale-105 ${
            accent ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {icon}
        </div>
      </div>
      <p className="relative mt-3 text-sm leading-6 text-slate-500">{detail}</p>
    </article>
  );
}

function Panel({
  title,
  description,
  children,
  action,
  className = "",
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[1.75rem] border border-slate-200/80 bg-white p-5 shadow-[0_12px_40px_rgba(15,23,42,0.04)] sm:p-6 ${className}`}
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-slate-950">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyChart({
  text = "Sem dados suficientes para este gráfico.",
}: {
  text?: string;
}) {
  return (
    <div className="flex h-72 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-6 text-center text-sm text-slate-400">
      {text}
    </div>
  );
}

function SelectField({
  value,
  onChange,
  children,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
      >
        {children}
      </select>
    </label>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full bg-gradient-to-r from-sky-500 to-cyan-400 transition-all duration-700"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

function DeltaBadge({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
        Sem comparação
      </span>
    );
  }

  const positive = value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
        positive
          ? "bg-emerald-50 text-emerald-700"
          : "bg-rose-50 text-rose-700"
      }`}
    >
      {positive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      {Math.abs(value)}%
    </span>
  );
}

function exportFlights(flights: Flight[]) {
  const headers = [
    "date",
    "departure",
    "arrival",
    "aircraft",
    "registration",
    "role",
    "pic_name",
    "total",
    "pic",
    "dual",
    "night",
    "ifr",
    "landings",
    "remarks",
  ];

  const escape = (value: unknown) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };

  const rows = flights.map((flight) => [
    flight.date,
    flight.departure_airport_name,
    flight.arrival_airport_name,
    flight.type_of_aircraft,
    flight.registration,
    flightRole(flight),
    flight.name_of_pilot_in_command,
    formatMinutes(flight.total_minutes || flight.synthetic_training_minutes),
    formatMinutes(flight.pilot_in_command_minutes),
    formatMinutes(flight.dual_minutes),
    formatMinutes(flight.night_minutes),
    formatMinutes(
      flight.single_engine_ifr_minutes + flight.multi_engine_ifr_minutes,
    ),
    flight.landings_day + flight.landings_night,
    flight.remarks_and_endorsements,
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map(escape).join(","))
    .join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "flight-stats.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [data, setData] = useState<FlightStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FlightStatsErrorResponse | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodKey>("all");
  const [selectedYear, setSelectedYear] = useState("all");
  const [selectedAircraft, setSelectedAircraft] = useState("all");
  const [selectedRegistration, setSelectedRegistration] = useState("all");
  const [search, setSearch] = useState("");
  const [visibleRows, setVisibleRows] = useState(PAGE_SIZE);
  const deferredSearch = useDeferredValue(search);

  const loadFlights = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/flights", {
        method: "GET",
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
      const message =
        caught instanceof Error ? caught.message : "Erro desconhecido.";
      const code =
        caught && typeof caught === "object" && "code" in caught
          ? String(caught.code ?? "")
          : undefined;
      setError({ error: message, code });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFlights();
  }, [loadFlights]);

  useEffect(() => {
    setVisibleRows(PAGE_SIZE);
  }, [
    deferredSearch,
    selectedAircraft,
    selectedPeriod,
    selectedRegistration,
    selectedYear,
  ]);

  const flights = data?.flights ?? [];

  const filterOptions = useMemo(() => {
    const years = uniqueSorted(
      flights.map((flight) => flight.date?.slice(0, 4) ?? null),
    ).reverse();
    const aircraft = uniqueSorted(
      flights.map((flight) => flight.type_of_aircraft),
    );
    const registrations = uniqueSorted(
      flights.map((flight) => flight.registration),
    );
    return { years, aircraft, registrations };
  }, [flights]);

  const filteredFlights = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();

    return flights.filter((flight) => {
      const matchesPeriod = dateMatchesPeriod(flight.date, selectedPeriod);
      const matchesYear =
        selectedYear === "all" || flight.date?.startsWith(selectedYear);
      const matchesAircraft =
        selectedAircraft === "all" ||
        flight.type_of_aircraft === selectedAircraft;
      const matchesRegistration =
        selectedRegistration === "all" ||
        flight.registration === selectedRegistration;
      const searchable = [
        flight.date,
        flight.departure_airport_name,
        flight.arrival_airport_name,
        flight.type_of_aircraft,
        flight.registration,
        flight.name_of_pilot_in_command,
        flight.remarks_and_endorsements,
        flightRole(flight),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return (
        matchesPeriod &&
        matchesYear &&
        matchesAircraft &&
        matchesRegistration &&
        (!query || searchable.includes(query))
      );
    });
  }, [
    deferredSearch,
    flights,
    selectedAircraft,
    selectedPeriod,
    selectedRegistration,
    selectedYear,
  ]);

  const stats = useMemo(() => {
    const flightRows = filteredFlights.filter(
      (flight) => flight.total_minutes > 0,
    );
    const total = sum(filteredFlights, (flight) => flight.total_minutes);
    const pic = sum(
      filteredFlights,
      (flight) => flight.pilot_in_command_minutes,
    );
    const dual = sum(filteredFlights, (flight) => flight.dual_minutes);
    const night = sum(filteredFlights, (flight) => flight.night_minutes);
    const simulator = sum(
      filteredFlights,
      (flight) => flight.synthetic_training_minutes,
    );
    const ifr = sum(
      filteredFlights,
      (flight) =>
        flight.single_engine_ifr_minutes + flight.multi_engine_ifr_minutes,
    );
    const vfr = sum(
      filteredFlights,
      (flight) =>
        flight.single_engine_vfr_minutes + flight.multi_engine_vfr_minutes,
    );
    const landings = sum(
      filteredFlights,
      (flight) => flight.landings_day + flight.landings_night,
    );
    const nightLandings = sum(
      filteredFlights,
      (flight) => flight.landings_night,
    );

    const airports = new Set(
      filteredFlights
        .flatMap((flight) => [
          flight.departure_airport_name,
          flight.arrival_airport_name,
        ])
        .filter(Boolean),
    );

    return {
      total,
      activity: total + simulator,
      pic,
      dual,
      night,
      simulator,
      ifr,
      vfr,
      landings,
      nightLandings,
      flightCount: flightRows.length,
      average: flightRows.length ? Math.round(total / flightRows.length) : 0,
      airportCount: airports.size,
    };
  }, [filteredFlights]);

  const comparison = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const previousYear = currentYear - 1;
    const previousCutoff = new Date(previousYear, now.getMonth(), now.getDate(), 23, 59, 59);

    const current = flights.filter((flight) => {
      if (!flight.date) return false;
      const date = new Date(`${flight.date}T12:00:00`);
      return date.getFullYear() === currentYear && date <= now;
    });

    const previous = flights.filter((flight) => {
      if (!flight.date) return false;
      const date = new Date(`${flight.date}T12:00:00`);
      return date.getFullYear() === previousYear && date <= previousCutoff;
    });

    const currentMinutes = sum(current, (flight) => flight.total_minutes);
    const previousMinutes = sum(previous, (flight) => flight.total_minutes);
    const delta = previousMinutes
      ? Math.round(((currentMinutes - previousMinutes) / previousMinutes) * 100)
      : null;

    return {
      currentYear,
      previousYear,
      currentMinutes,
      previousMinutes,
      currentFlights: current.filter((flight) => flight.total_minutes > 0).length,
      previousFlights: previous.filter((flight) => flight.total_minutes > 0).length,
      delta,
    };
  }, [flights]);

  const monthlyData = useMemo(() => {
    const map = new Map<
      string,
      { flightMinutes: number; simulatorMinutes: number; flights: number }
    >();

    for (const flight of filteredFlights) {
      if (!flight.date) continue;
      const key = flight.date.slice(0, 7);
      const item = map.get(key) ?? {
        flightMinutes: 0,
        simulatorMinutes: 0,
        flights: 0,
      };
      item.flightMinutes += flight.total_minutes;
      item.simulatorMinutes += flight.synthetic_training_minutes;
      item.flights += flight.total_minutes > 0 ? 1 : 0;
      map.set(key, item);
    }

    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-18)
      .map(([key, value]) => ({
        label: monthLabel(key),
        flightHours: decimalHours(value.flightMinutes),
        simulatorHours: decimalHours(value.simulatorMinutes),
        flights: value.flights,
      }));
  }, [filteredFlights]);

  const cumulativeData = useMemo(() => {
    let running = 0;
    return monthlyData.map((row) => {
      running += (row.flightHours ?? 0) + (row.simulatorHours ?? 0);
      return { label: row.label, total: Number(running.toFixed(1)) };
    });
  }, [monthlyData]);

  const aircraftData = useMemo(() => {
    const map = new Map<string, number>();
    for (const flight of filteredFlights) {
      const label = flight.type_of_aircraft || "Sem modelo";
      map.set(label, (map.get(label) ?? 0) + flight.total_minutes);
    }
    return [...map.entries()]
      .map(([label, minutes]) => ({ label, hours: decimalHours(minutes) }))
      .filter((row) => (row.hours ?? 0) > 0)
      .sort((a, b) => (b.hours ?? 0) - (a.hours ?? 0))
      .slice(0, 8);
  }, [filteredFlights]);

  const conditionsData = useMemo<ChartRow[]>(
    () =>
      [
        { label: "VFR", value: stats.vfr },
        { label: "IFR", value: stats.ifr },
      ].filter((row) => (row.value ?? 0) > 0),
    [stats.ifr, stats.vfr],
  );

  const airportData = useMemo(() => {
    const map = new Map<string, number>();
    for (const flight of filteredFlights) {
      for (const airport of [
        flight.departure_airport_name,
        flight.arrival_airport_name,
      ]) {
        if (!airport) continue;
        map.set(airport, (map.get(airport) ?? 0) + 1);
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, visits]) => ({ label, visits }));
  }, [filteredFlights]);

  const latestFlight = flights.find((flight) => flight.total_minutes > 0) ?? null;
  const latestFlightDays = daysSince(latestFlight?.date);
  const overallTotalMinutes = sum(flights, (flight) => flight.total_minutes);
  const overallSimulatorMinutes = sum(
    flights,
    (flight) => flight.synthetic_training_minutes,
  );
  const totalMilestone = nextMilestone(overallTotalMinutes);
  const picMilestone = nextMilestone(
    sum(flights, (flight) => flight.pilot_in_command_minutes),
  );
  const visibleFlights = filteredFlights.slice(0, visibleRows);
  const profileName = data
    ? `${data.profile.firstName} ${data.profile.lastName}`.trim()
    : "Flight Stats";
  const activeFilterCount = [
    selectedPeriod !== "all",
    selectedYear !== "all",
    selectedAircraft !== "all",
    selectedRegistration !== "all",
    Boolean(search.trim()),
  ].filter(Boolean).length;

  const setPeriod = (period: PeriodKey) => {
    setSelectedPeriod(period);
    if (period !== "all") setSelectedYear("all");
  };

  const setYear = (year: string) => {
    setSelectedYear(year);
    if (year !== "all") setSelectedPeriod("all");
  };

  const resetFilters = () => {
    setSelectedPeriod("all");
    setSelectedYear("all");
    setSelectedAircraft("all");
    setSelectedRegistration("all");
    setSearch("");
  };

  if (!data && loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f4f7fb] px-6">
        <div className="w-full max-w-md rounded-[2rem] border border-slate-200/80 bg-white p-8 text-center shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-50 text-sky-700">
            <RefreshCw className="animate-spin" size={26} />
          </div>
          <h1 className="mt-5 text-xl font-semibold text-slate-950">
            A sincronizar o logbook
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            A obter os dados mais recentes diretamente do FlightLogger.
          </p>
          <div className="mt-6 space-y-2" aria-hidden="true">
            <div className="h-2 animate-pulse rounded-full bg-slate-100" />
            <div className="mx-auto h-2 w-2/3 animate-pulse rounded-full bg-slate-100" />
          </div>
        </div>
      </main>
    );
  }

  if (!data && error) {
    const needsToken = error.code === "FLIGHTLOGGER_NOT_CONFIGURED";
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f4f7fb] px-6 py-12">
        <section className="w-full max-w-2xl rounded-[2rem] border border-slate-200 bg-white p-8 shadow-[0_24px_70px_rgba(15,23,42,0.08)] sm:p-10">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
            <ShieldCheck size={27} />
          </div>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-slate-950">
            {needsToken
              ? "Falta ligar o FlightLogger"
              : "Não foi possível sincronizar"}
          </h1>
          <p className="mt-3 text-sm leading-7 text-slate-600">{error.error}</p>
          <button
            type="button"
            onClick={() => void loadFlights()}
            className="mt-7 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-slate-200"
          >
            <RefreshCw size={16} />
            Tentar novamente
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f4f7fb] text-slate-950">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[520px] bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.12),transparent_42%),radial-gradient(circle_at_top_right,rgba(124,58,237,0.08),transparent_38%)]" />
      <div className="relative mx-auto max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <header className="overflow-hidden rounded-[2.2rem] border border-slate-800 bg-slate-950 text-white shadow-[0_28px_80px_rgba(15,23,42,0.2)]">
          <div className="relative p-6 sm:p-8 lg:p-10">
            <div className="absolute -right-20 -top-24 h-80 w-80 rounded-full bg-sky-500/20 blur-3xl" />
            <div className="absolute -bottom-32 left-1/3 h-80 w-80 rounded-full bg-violet-500/10 blur-3xl" />
            <div className="relative grid gap-9 lg:grid-cols-[1fr_auto] lg:items-end">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-sky-100 backdrop-blur">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                  </span>
                  FlightLogger ligado
                </div>
                <p className="mt-6 text-sm font-medium uppercase tracking-[0.18em] text-slate-400">
                  Flight Stats
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] sm:text-5xl">
                  {profileName}
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                  O teu logbook transformado numa visão clara de experiência,
                  progressão, recência e distribuição operacional.
                </p>
                <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-300">
                  <span className="inline-flex items-center gap-2">
                    <Activity size={15} className="text-sky-300" />
                    {flights.length} registos sincronizados
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <RefreshCw size={15} className="text-sky-300" />
                    Atualizado {data ? formatDateTime(data.syncedAt) : "—"}
                  </span>
                </div>
              </div>

              <div className="w-full max-w-sm rounded-[1.75rem] border border-white/10 bg-white/[0.07] p-5 backdrop-blur-xl lg:w-[360px]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-slate-300">Experiência total</p>
                    <p className="mt-2 text-4xl font-semibold tracking-[-0.05em]">
                      {formatMinutes(overallTotalMinutes + overallSimulatorMinutes)}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">
                      {formatMinutes(overallTotalMinutes)} voo · {formatMinutes(overallSimulatorMinutes)} sim
                    </p>
                  </div>
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-400/15 text-sky-300">
                    <Award size={22} />
                  </div>
                </div>
                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between text-xs text-slate-300">
                    <span>Próximo marco: {totalMilestone.targetHours}h</span>
                    <span>{formatMinutes(totalMilestone.remainingMinutes)} em falta</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-sky-400 to-cyan-300"
                      style={{ width: `${totalMilestone.progress}%` }}
                    />
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => exportFlights(filteredFlights)}
                    disabled={filteredFlights.length === 0}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/15 disabled:opacity-40"
                  >
                    <Download size={16} />
                    CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadFlights()}
                    disabled={loading}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-100 disabled:opacity-60"
                  >
                    <RefreshCw
                      className={loading ? "animate-spin" : ""}
                      size={16}
                    />
                    Atualizar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </header>

        {error && data ? (
          <div
            className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            role="status"
          >
            <ShieldCheck className="mt-0.5 shrink-0" size={17} />
            <div className="flex-1">
              <p className="font-medium">A última atualização falhou</p>
              <p className="mt-0.5 text-amber-700">{error.error}</p>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Fechar aviso"
              className="rounded-lg p-1 transition hover:bg-amber-100"
            >
              <X size={16} />
            </button>
          </div>
        ) : null}

        <section className="sticky top-3 z-20 mt-5 rounded-[1.75rem] border border-slate-200/80 bg-white/90 p-4 shadow-[0_16px_45px_rgba(15,23,42,0.08)] backdrop-blur-xl sm:p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap gap-2" aria-label="Período">
                {periodOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPeriod(option.value)}
                    className={`rounded-full px-3.5 py-2 text-sm font-medium transition focus:outline-none focus:ring-4 focus:ring-sky-100 ${
                      selectedPeriod === option.value
                        ? "bg-slate-950 text-white shadow-sm"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-emerald-600" />
                  {filteredFlights.length} resultados
                </span>
                {activeFilterCount ? (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 font-medium text-slate-600 transition hover:bg-slate-200"
                  >
                    <X size={13} />
                    Limpar {activeFilterCount}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[0.8fr_1fr_1fr_1.5fr]">
              <SelectField label="Ano" value={selectedYear} onChange={setYear}>
                <option value="all">Todos os anos</option>
                {filterOptions.years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Aeronave"
                value={selectedAircraft}
                onChange={setSelectedAircraft}
              >
                <option value="all">Todos os modelos</option>
                {filterOptions.aircraft.map((aircraft) => (
                  <option key={aircraft} value={aircraft}>
                    {aircraft}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Matrícula"
                value={selectedRegistration}
                onChange={setSelectedRegistration}
              >
                <option value="all">Todas as matrículas</option>
                {filterOptions.registrations.map((registration) => (
                  <option key={registration} value={registration}>
                    {registration}
                  </option>
                ))}
              </SelectField>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">
                  Pesquisa
                </span>
                <span className="flex items-center rounded-2xl border border-slate-200 bg-white px-3.5 focus-within:border-sky-400 focus-within:ring-4 focus-within:ring-sky-100">
                  <Search size={16} className="text-slate-400" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Aeroporto, matrícula, PIC, função..."
                    className="w-full bg-transparent px-3 py-3 text-sm outline-none placeholder:text-slate-400"
                  />
                  {search ? (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      aria-label="Limpar pesquisa"
                      className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    >
                      <X size={15} />
                    </button>
                  ) : null}
                </span>
              </label>
            </div>
          </div>
        </section>

        <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <MetricCard
            label="Tempo de voo"
            value={formatMinutes(stats.total)}
            detail={`${stats.flightCount} voos · média ${formatMinutes(stats.average)}`}
            icon={<Clock3 size={20} />}
            accent
          />
          <MetricCard
            label="PIC"
            value={formatMinutes(stats.pic)}
            detail={`${stats.total ? Math.round((stats.pic / stats.total) * 100) : 0}% do tempo de voo`}
            icon={<Plane size={20} />}
          />
          <MetricCard
            label="IFR"
            value={formatMinutes(stats.ifr)}
            detail={`${formatMinutes(stats.vfr)} registadas em VFR`}
            icon={<Gauge size={20} />}
          />
          <MetricCard
            label="Noite"
            value={formatMinutes(stats.night)}
            detail={`${stats.nightLandings} aterragens noturnas`}
            icon={<Moon size={20} />}
          />
          <MetricCard
            label="Simulador"
            value={formatMinutes(stats.simulator)}
            detail={`${formatMinutes(stats.dual)} em instrução dual`}
            icon={<Monitor size={20} />}
          />
          <MetricCard
            label="Aterragens"
            value={String(stats.landings)}
            detail={`${stats.airportCount} aeroportos diferentes`}
            icon={<PlaneLanding size={20} />}
          />
        </section>

        <section className="mt-5 grid gap-5 xl:grid-cols-[1.35fr_1fr]">
          <Panel
            title="Atividade mensal"
            description="Horas de voo e simulador por mês, nos últimos 18 meses visíveis."
            action={
              <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
                {formatMinutes(stats.activity)} selecionadas
              </span>
            }
          >
            {monthlyData.length ? (
              <div className="h-80 w-full">
                <ResponsiveContainer>
                  <BarChart
                    data={monthlyData}
                    margin={{ top: 8, right: 8, bottom: 18, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "#64748b", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: "#64748b", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle()}
                      formatter={(value, name) => [
                        `${Number(value).toFixed(1)} h`,
                        name === "flightHours" ? "Voo" : "Simulador",
                      ]}
                    />
                    <Legend
                      formatter={(value) =>
                        value === "flightHours" ? "Voo" : "Simulador"
                      }
                    />
                    <Bar
                      dataKey="flightHours"
                      stackId="activity"
                      fill="#0284c7"
                      radius={[7, 7, 0, 0]}
                    />
                    <Bar
                      dataKey="simulatorHours"
                      stackId="activity"
                      fill="#7c3aed"
                      radius={[7, 7, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyChart />
            )}
          </Panel>

          <Panel
            title={`Comparação ${comparison.currentYear}`}
            description={`Mesmo período de ${comparison.previousYear}, para uma comparação justa.`}
          >
            <div className="rounded-3xl bg-slate-950 p-5 text-white">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-slate-400">Este ano</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight">
                    {formatMinutes(comparison.currentMinutes)}
                  </p>
                  <p className="mt-1 text-sm text-slate-400">
                    {comparison.currentFlights} voos
                  </p>
                </div>
                <DeltaBadge value={comparison.delta} />
              </div>
              <div className="mt-6 border-t border-white/10 pt-5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">{comparison.previousYear}</span>
                  <span className="font-medium">
                    {formatMinutes(comparison.previousMinutes)} · {comparison.previousFlights} voos
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-4">
                <TrendingUp size={18} className="text-sky-700" />
                <p className="mt-3 text-sm font-medium text-slate-950">
                  Ritmo anual
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  {comparison.delta === null
                    ? "Ainda não existe base comparável no ano anterior."
                    : comparison.delta >= 0
                      ? `Estás ${comparison.delta}% acima do mesmo período.`
                      : `Estás ${Math.abs(comparison.delta)}% abaixo do mesmo período.`}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <CalendarDays size={18} className="text-sky-700" />
                <p className="mt-3 text-sm font-medium text-slate-950">
                  Último voo
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  {latestFlightDays === null
                    ? "Sem data disponível."
                    : latestFlightDays === 0
                      ? "Hoje"
                      : `Há ${latestFlightDays} dias`}
                  {latestFlight?.registration
                    ? ` · ${latestFlight.registration}`
                    : ""}
                </p>
              </div>
            </div>
          </Panel>
        </section>

        <section className="mt-5 grid gap-5 lg:grid-cols-2 xl:grid-cols-4">
          <Panel title="Próximo marco total" description="Progresso para o próximo número redondo.">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-700">
                <Target size={22} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-end justify-between gap-3">
                  <p className="text-2xl font-semibold">{totalMilestone.targetHours}h</p>
                  <p className="text-xs text-slate-500">
                    faltam {formatMinutes(totalMilestone.remainingMinutes)}
                  </p>
                </div>
                <div className="mt-3">
                  <ProgressBar value={totalMilestone.progress} />
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Próximo marco PIC" description="Evolução específica de pilot-in-command.">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                <Award size={22} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-end justify-between gap-3">
                  <p className="text-2xl font-semibold">{picMilestone.targetHours}h</p>
                  <p className="text-xs text-slate-500">
                    faltam {formatMinutes(picMilestone.remainingMinutes)}
                  </p>
                </div>
                <div className="mt-3">
                  <ProgressBar value={picMilestone.progress} />
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Aeronave principal" description="Modelo com mais tempo nos filtros atuais.">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-700">
                <Plane size={22} />
              </div>
              <div>
                <p className="text-2xl font-semibold">
                  {aircraftData[0]?.label ?? "—"}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {aircraftData[0]?.hours ? `${aircraftData[0].hours}h registadas` : "Sem dados"}
                </p>
              </div>
            </div>
          </Panel>

          <Panel title="Aeroporto mais frequente" description="Partidas e chegadas combinadas.">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
                <MapPin size={22} />
              </div>
              <div>
                <p className="text-2xl font-semibold">
                  {airportData[0]?.label ?? "—"}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {airportData[0]
                    ? `${airportData[0].visits} movimentos registados`
                    : "Sem dados"}
                </p>
              </div>
            </div>
          </Panel>
        </section>

        <section className="mt-5 grid gap-5 xl:grid-cols-2">
          <Panel
            title="Progressão acumulada"
            description="Evolução do total de atividade ao longo dos meses selecionados."
          >
            {cumulativeData.length ? (
              <div className="h-72 w-full">
                <ResponsiveContainer>
                  <AreaChart
                    data={cumulativeData}
                    margin={{ top: 8, right: 8, bottom: 18, left: 0 }}
                  >
                    <defs>
                      <linearGradient id="totalGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0284c7" stopOpacity={0.24} />
                        <stop offset="95%" stopColor="#0284c7" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "#64748b", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: "#64748b", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle()}
                      formatter={(value) => [`${value} h`, "Acumulado"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="total"
                      stroke="#0284c7"
                      fill="url(#totalGradient)"
                      strokeWidth={2.5}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyChart />
            )}
          </Panel>

          <Panel
            title="Horas por modelo"
            description="Distribuição consolidada por tipo de aeronave."
          >
            {aircraftData.length ? (
              <div className="h-72 w-full">
                <ResponsiveContainer>
                  <BarChart
                    data={aircraftData}
                    layout="vertical"
                    margin={{ top: 8, right: 20, bottom: 8, left: 30 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fill: "#64748b", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={90}
                      tick={{ fill: "#64748b", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle()}
                      formatter={(value) => [`${value} h`, "Horas"]}
                    />
                    <Bar
                      dataKey="hours"
                      fill="#0f172a"
                      radius={[0, 8, 8, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyChart />
            )}
          </Panel>
        </section>

        <section className="mt-5 grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
          <Panel
            title="VFR vs IFR"
            description="Distribuição das horas classificadas por regras de voo."
          >
            {conditionsData.length ? (
              <div className="grid gap-5 sm:grid-cols-[210px_1fr] sm:items-center">
                <div className="relative h-56">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={conditionsData}
                        dataKey="value"
                        nameKey="label"
                        innerRadius={58}
                        outerRadius={88}
                        paddingAngle={4}
                      >
                        {conditionsData.map((entry, index) => (
                          <Cell
                            key={entry.label}
                            fill={chartColors[index % chartColors.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={tooltipStyle()}
                        formatter={(value) => [formatMinutes(Number(value)), ""]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <p className="text-xs text-slate-400">Classificado</p>
                      <p className="mt-1 text-lg font-semibold">
                        {formatMinutes(stats.vfr + stats.ifr)}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  {conditionsData.map((item, index) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3"
                    >
                      <span className="flex items-center gap-2 text-sm text-slate-600">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{
                            backgroundColor:
                              chartColors[index % chartColors.length],
                          }}
                        />
                        {item.label}
                      </span>
                      <span className="font-semibold text-slate-950">
                        {formatMinutes(item.value ?? 0)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyChart text="O FlightLogger ainda não tem horas VFR/IFR classificadas nestes registos." />
            )}
          </Panel>

          <Panel
            title="Voos recentes"
            description={`${filteredFlights.length} registos correspondem aos filtros atuais.`}
            action={
              <span className="hidden items-center gap-1.5 text-xs text-slate-400 sm:inline-flex">
                <Route size={14} />
                mais recente primeiro
              </span>
            }
          >
            <div className="space-y-3 md:hidden">
              {visibleFlights.map((flight) => {
                const role = flightRole(flight);
                return (
                  <article
                    key={flight.id}
                    className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs text-slate-400">{formatDate(flight.date)}</p>
                        <p className="mt-1 font-semibold text-slate-950">
                          {flight.departure_airport_name || "—"} → {flight.arrival_airport_name || "—"}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${roleClasses(role)}`}
                      >
                        {role}
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-slate-400">Aeronave</p>
                        <p className="mt-1 font-medium text-slate-700">
                          {flight.type_of_aircraft || "—"} · {flight.registration || "—"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-400">Tempo</p>
                        <p className="mt-1 font-semibold text-slate-950">
                          {formatMinutes(
                            flight.total_minutes || flight.synthetic_training_minutes,
                          )}
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[860px] border-separate border-spacing-0 text-left text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-[0.13em] text-slate-400">
                    <th className="border-b border-slate-200 px-3 py-3 font-semibold">Data</th>
                    <th className="border-b border-slate-200 px-3 py-3 font-semibold">Rota</th>
                    <th className="border-b border-slate-200 px-3 py-3 font-semibold">Aeronave</th>
                    <th className="border-b border-slate-200 px-3 py-3 font-semibold">Tempo</th>
                    <th className="border-b border-slate-200 px-3 py-3 font-semibold">Função</th>
                    <th className="border-b border-slate-200 px-3 py-3 font-semibold">PIC</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleFlights.map((flight) => {
                    const role = flightRole(flight);
                    return (
                      <tr
                        key={flight.id}
                        className="text-slate-700 transition hover:bg-slate-50/80"
                      >
                        <td className="whitespace-nowrap border-b border-slate-100 px-3 py-4">
                          {formatDate(flight.date)}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-4">
                          <span className="inline-flex items-center gap-2 font-medium text-slate-950">
                            <MapPin size={14} className="text-sky-600" />
                            {flight.departure_airport_name || "—"} → {flight.arrival_airport_name || "—"}
                          </span>
                        </td>
                        <td className="border-b border-slate-100 px-3 py-4">
                          <div className="font-medium text-slate-950">
                            {flight.type_of_aircraft || "—"}
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            {flight.registration || "Sem matrícula"}
                          </div>
                        </td>
                        <td className="border-b border-slate-100 px-3 py-4 font-semibold text-slate-950">
                          {formatMinutes(
                            flight.total_minutes || flight.synthetic_training_minutes,
                          )}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-4">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${roleClasses(role)}`}
                          >
                            {role}
                          </span>
                        </td>
                        <td className="border-b border-slate-100 px-3 py-4">
                          {flight.name_of_pilot_in_command || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {visibleFlights.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-400">
                Sem voos para os filtros selecionados.
              </div>
            ) : null}

            {visibleRows < filteredFlights.length ? (
              <div className="mt-5 flex justify-center">
                <button
                  type="button"
                  onClick={() => setVisibleRows((current) => current + PAGE_SIZE)}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-100"
                >
                  Mostrar mais voos
                </button>
              </div>
            ) : null}
          </Panel>
        </section>

        <footer className="mt-7 flex flex-col gap-2 px-2 pb-4 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Dados lidos diretamente do FlightLogger; nenhum voo é guardado nesta aplicação.
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Sparkles size={13} />
            Dashboard atualizado em tempo real
          </span>
        </footer>
      </div>
    </main>
  );
}
