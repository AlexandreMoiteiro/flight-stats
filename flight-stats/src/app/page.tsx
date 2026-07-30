"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  CalendarDays,
  Clock3,
  Download,
  Gauge,
  MapPin,
  Monitor,
  Moon,
  Plane,
  PlaneLanding,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import type {
  Flight,
  FlightStatsErrorResponse,
  FlightStatsResponse,
} from "@/lib/flight-types";

type ChartRow = {
  label: string;
  hours?: number;
  flights?: number;
  value?: number;
  total?: number;
};

const chartColors = ["#0f172a", "#0284c7", "#64748b", "#94a3b8"];

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

function tooltipStyle() {
  return {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "14px",
    color: "#0f172a",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.12)",
  };
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
      className={`rounded-3xl border p-5 shadow-sm ${
        accent
          ? "border-sky-200 bg-gradient-to-br from-sky-50 to-white"
          : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
            {value}
          </p>
        </div>
        <div
          className={`rounded-2xl p-2.5 ${
            accent ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {icon}
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-500">{detail}</p>
    </article>
  );
}

function Panel({
  title,
  description,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 ${className}`}
    >
      <div className="mb-5">
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
        ) : null}
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
    <div className="flex h-72 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 text-center text-sm text-slate-400">
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
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
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

function exportFlights(flights: Flight[]) {
  const headers = [
    "date",
    "departure",
    "arrival",
    "aircraft",
    "registration",
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
    flight.name_of_pilot_in_command,
    formatMinutes(flight.total_minutes),
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
  const [selectedYear, setSelectedYear] = useState("all");
  const [selectedAircraft, setSelectedAircraft] = useState("all");
  const [selectedRegistration, setSelectedRegistration] = useState("all");
  const [search, setSearch] = useState("");

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
    const query = search.trim().toLowerCase();

    return flights.filter((flight) => {
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
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return (
        matchesYear &&
        matchesAircraft &&
        matchesRegistration &&
        (!query || searchable.includes(query))
      );
    });
  }, [flights, search, selectedAircraft, selectedRegistration, selectedYear]);

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

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const last90 = filteredFlights.filter((flight) => {
      if (!flight.date) return false;
      return new Date(`${flight.date}T12:00:00`) >= cutoff;
    });

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
      pic,
      dual,
      night,
      simulator,
      ifr,
      vfr,
      landings,
      flightCount: flightRows.length,
      average: flightRows.length ? Math.round(total / flightRows.length) : 0,
      last90Minutes: sum(last90, (flight) => flight.total_minutes),
      last90Flights: last90.filter((flight) => flight.total_minutes > 0).length,
      airportCount: airports.size,
    };
  }, [filteredFlights]);

  const monthlyData = useMemo(() => {
    const map = new Map<string, { minutes: number; flights: number }>();

    for (const flight of filteredFlights) {
      if (!flight.date) continue;
      const key = flight.date.slice(0, 7);
      const item = map.get(key) ?? { minutes: 0, flights: 0 };
      item.minutes +=
        flight.total_minutes + flight.synthetic_training_minutes;
      item.flights += flight.total_minutes > 0 ? 1 : 0;
      map.set(key, item);
    }

    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-18)
      .map(([key, value]) => ({
        label: monthLabel(key),
        hours: decimalHours(value.minutes),
        flights: value.flights,
      }));
  }, [filteredFlights]);

  const cumulativeData = useMemo(() => {
    let running = 0;
    return monthlyData.map((row) => {
      running += row.hours ?? 0;
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

  const conditionsData: ChartRow[] = [
    { label: "VFR", value: stats.vfr },
    { label: "IFR", value: stats.ifr },
  ].filter((row) => (row.value ?? 0) > 0);

  const recentFlights = filteredFlights.slice(0, 10);
  const profileName = data
    ? `${data.profile.firstName} ${data.profile.lastName}`.trim()
    : "Flight Stats";

  const resetFilters = () => {
    setSelectedYear("all");
    setSelectedAircraft("all");
    setSelectedRegistration("all");
    setSearch("");
  };

  if (!data && loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-50 text-sky-700">
            <RefreshCw className="animate-spin" size={26} />
          </div>
          <h1 className="mt-5 text-xl font-semibold text-slate-950">
            A sincronizar o logbook
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            A obter os dados mais recentes diretamente do FlightLogger.
          </p>
        </div>
      </main>
    );
  }

  if (!data && error) {
    const needsToken = error.code === "FLIGHTLOGGER_NOT_CONFIGURED";
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
        <section className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
            <ShieldCheck size={27} />
          </div>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-slate-950">
            {needsToken
              ? "Falta ligar o FlightLogger"
              : "Não foi possível sincronizar"}
          </h1>
          <p className="mt-3 text-sm leading-7 text-slate-600">{error.error}</p>
          {needsToken ? (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-7 text-slate-600">
              Adiciona a variável{" "}
              <code className="rounded bg-white px-1.5 py-0.5 font-mono text-slate-900">
                FLIGHTLOGGER_API_TOKEN
              </code>{" "}
              ao projeto <strong>flight-stats</strong> na Vercel e faz um novo
              deployment. O token fica apenas no servidor e nunca é enviado
              para o browser.
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => void loadFlights()}
            className="mt-7 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            <RefreshCw size={16} />
            Tentar novamente
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <header className="overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 text-white shadow-sm">
          <div className="relative p-6 sm:p-8 lg:p-10">
            <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-sky-500/20 blur-3xl" />
            <div className="absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-indigo-400/10 blur-3xl" />
            <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-sky-100">
                  <Sparkles size={14} />
                  Sincronização direta com FlightLogger
                </div>
                <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">
                  {profileName}
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                  Uma visão clara da experiência de voo, recência, aeronaves e
                  progressão — sempre com os dados mais recentes do teu logbook.
                </p>
                <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-300">
                  <span className="inline-flex items-center gap-2">
                    <Activity size={15} className="text-sky-300" />
                    {flights.length} registos
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <RefreshCw size={15} className="text-sky-300" />
                    Atualizado {data ? formatDateTime(data.syncedAt) : "—"}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => exportFlights(filteredFlights)}
                  disabled={filteredFlights.length === 0}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/15 disabled:opacity-40"
                >
                  <Download size={16} />
                  Exportar CSV
                </button>
                <button
                  type="button"
                  onClick={() => void loadFlights()}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-100 disabled:opacity-60"
                >
                  <RefreshCw
                    className={loading ? "animate-spin" : ""}
                    size={16}
                  />
                  Atualizar dados
                </button>
              </div>
            </div>
          </div>
        </header>

        <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1.4fr_auto] xl:items-end">
            <SelectField
              label="Ano"
              value={selectedYear}
              onChange={setSelectedYear}
            >
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
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                Pesquisa
              </span>
              <span className="flex items-center rounded-2xl border border-slate-200 bg-white px-3.5 focus-within:border-sky-400 focus-within:ring-4 focus-within:ring-sky-100">
                <Search size={16} className="text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Aeroporto, PIC, observação..."
                  className="w-full bg-transparent px-3 py-3 text-sm outline-none placeholder:text-slate-400"
                />
              </span>
            </label>
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
            >
              Limpar
            </button>
          </div>
        </section>

        <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <MetricCard
            label="Tempo total"
            value={formatMinutes(stats.total)}
            detail={`${stats.flightCount} voos · média ${formatMinutes(stats.average)}`}
            icon={<Clock3 size={20} />}
            accent
          />
          <MetricCard
            label="PIC"
            value={formatMinutes(stats.pic)}
            detail={`${
              stats.total ? Math.round((stats.pic / stats.total) * 100) : 0
            }% do tempo de voo`}
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
            detail={`${stats.landings} aterragens no total`}
            icon={<Moon size={20} />}
          />
          <MetricCard
            label="Simulador"
            value={formatMinutes(stats.simulator)}
            detail={`${formatMinutes(stats.dual)} em instrução dual`}
            icon={<Monitor size={20} />}
          />
          <MetricCard
            label="Últimos 90 dias"
            value={formatMinutes(stats.last90Minutes)}
            detail={`${stats.last90Flights} voos recentes`}
            icon={<CalendarDays size={20} />}
          />
        </section>

        <section className="mt-5 grid gap-5 xl:grid-cols-[1.45fr_1fr]">
          <Panel
            title="Atividade mensal"
            description="Horas de voo e simulador por mês, nos últimos 18 meses visíveis."
          >
            {monthlyData.length ? (
              <div className="h-80 w-full">
                <ResponsiveContainer>
                  <BarChart
                    data={monthlyData}
                    margin={{ top: 8, right: 8, bottom: 18, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "#64748b", fontSize: 11 }}
                    />
                    <YAxis tick={{ fill: "#64748b", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={tooltipStyle()}
                      formatter={(value) => [`${value} h`, "Horas"]}
                    />
                    <Bar
                      dataKey="hours"
                      fill="#0284c7"
                      radius={[8, 8, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyChart />
            )}
          </Panel>

          <Panel
            title="Recência e alcance"
            description="Indicadores rápidos que ajudam a perceber ritmo e variedade."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-4">
                <MapPin size={19} className="text-sky-700" />
                <p className="mt-4 text-2xl font-semibold">
                  {stats.airportCount}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  aeroportos diferentes
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <PlaneLanding size={19} className="text-sky-700" />
                <p className="mt-4 text-2xl font-semibold">{stats.landings}</p>
                <p className="mt-1 text-sm text-slate-500">
                  aterragens registadas
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <Activity size={19} className="text-sky-700" />
                <p className="mt-4 text-2xl font-semibold">
                  {stats.last90Flights}
                </p>
                <p className="mt-1 text-sm text-slate-500">voos em 90 dias</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <Clock3 size={19} className="text-sky-700" />
                <p className="mt-4 text-2xl font-semibold">
                  {formatMinutes(stats.average)}
                </p>
                <p className="mt-1 text-sm text-slate-500">duração média</p>
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
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "#64748b", fontSize: 11 }}
                    />
                    <YAxis tick={{ fill: "#64748b", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={tooltipStyle()}
                      formatter={(value) => [`${value} h`, "Acumulado"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="total"
                      stroke="#0f172a"
                      fill="#dbeafe"
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
            description="O PA-28 e o Piper PA-28 são agora consolidados como PA-28."
          >
            {aircraftData.length ? (
              <div className="h-72 w-full">
                <ResponsiveContainer>
                  <BarChart
                    data={aircraftData}
                    layout="vertical"
                    margin={{ top: 8, right: 20, bottom: 8, left: 30 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      type="number"
                      tick={{ fill: "#64748b", fontSize: 11 }}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={90}
                      tick={{ fill: "#64748b", fontSize: 11 }}
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
              <div className="grid gap-5 sm:grid-cols-[220px_1fr] sm:items-center">
                <div className="h-56">
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
                        formatter={(value) => [
                          formatMinutes(Number(value)),
                          "",
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
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
            title="Voos mais recentes"
            description={`${filteredFlights.length} registos correspondem aos filtros atuais.`}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-separate border-spacing-0 text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-[0.12em] text-slate-400">
                    <th className="border-b border-slate-200 px-3 py-3 font-semibold">
                      Data
                    </th>
                    <th className="border-b border-slate-200 px-3 py-3 font-semibold">
                      Rota
                    </th>
                    <th className="border-b border-slate-200 px-3 py-3 font-semibold">
                      Aeronave
                    </th>
                    <th className="border-b border-slate-200 px-3 py-3 font-semibold">
                      Tempo
                    </th>
                    <th className="border-b border-slate-200 px-3 py-3 font-semibold">
                      Função
                    </th>
                    <th className="border-b border-slate-200 px-3 py-3 font-semibold">
                      PIC
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentFlights.map((flight) => (
                    <tr key={flight.id} className="text-slate-700">
                      <td className="whitespace-nowrap border-b border-slate-100 px-3 py-4">
                        {formatDate(flight.date)}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-4">
                        <span className="inline-flex items-center gap-2 font-medium text-slate-950">
                          <MapPin size={14} className="text-sky-600" />
                          {flight.departure_airport_name || "—"} →{" "}
                          {flight.arrival_airport_name || "—"}
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
                          flight.total_minutes ||
                            flight.synthetic_training_minutes,
                        )}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-4">
                        {flight.pilot_in_command_minutes > 0
                          ? "PIC"
                          : flight.dual_minutes > 0
                            ? "Dual"
                            : flight.co_pilot_minutes > 0
                              ? "Co-pilot"
                              : flight.synthetic_training_minutes > 0
                                ? "SIM"
                                : "—"}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-4">
                        {flight.name_of_pilot_in_command || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {recentFlights.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-400">
                  Sem voos para os filtros selecionados.
                </div>
              ) : null}
            </div>
          </Panel>
        </section>

        <footer className="mt-6 px-2 pb-4 text-xs text-slate-400">
          Dados lidos diretamente do FlightLogger; nenhum voo é guardado nesta
          aplicação.
        </footer>
      </div>
    </main>
  );
}
