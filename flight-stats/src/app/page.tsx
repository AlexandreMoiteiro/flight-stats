"use client";

import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import type { User } from "firebase/auth";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithRedirect,
  signOut,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  Download,
  Gauge,
  LogOut,
  Moon,
  Plane,
  PlaneLanding,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import { auth, db, type Flight, type FlightInsert } from "@/lib/firebase";

const allowedEmail = process.env.NEXT_PUBLIC_ALLOWED_EMAIL ?? "";

type CsvRow = Record<string, string | number | boolean | null | undefined>;

type ChartRow = {
  label: string;
  horas?: number;
  voo?: number;
  simulador?: number;
  total?: number;
  voos?: number;
  aterragens?: number;
  movimentos?: number;
  value?: number;
};

const chartColors = ["#0f172a", "#64748b", "#94a3b8", "#cbd5e1", "#0284c7", "#0369a1"];

function getFlightsCollection(userId: string) {
  return collection(db, "users", userId, "flights");
}

function cleanText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "nan") return null;
  return text;
}

function numberOrZero(value: unknown): number {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!text || text.toLowerCase() === "nan") return 0;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function booleanOrNull(value: unknown): boolean | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (["true", "yes", "sim", "1"].includes(text)) return true;
  if (["false", "no", "não", "nao", "0"].includes(text)) return false;
  return null;
}

function timeToMinutes(value: unknown): number {
  const text = String(value ?? "").trim();

  if (!text || text.toLowerCase() === "nan") return 0;

  if (text.includes(":")) {
    const [hoursRaw, minutesRaw] = text.split(":");
    const hours = Number(hoursRaw);
    const minutes = Number(minutesRaw);

    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;

    return hours * 60 + minutes;
  }

  const decimalHours = Number(text.replace(",", "."));
  if (!Number.isFinite(decimalHours)) return 0;

  return Math.round(decimalHours * 60);
}

function parseDateDMY(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const parts = text.split(".");
  if (parts.length !== 3) return null;

  const [day, month, year] = parts;
  if (!day || !month || !year) return null;

  return `${year.padStart(4, "20")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function formatDate(date: string | null | undefined): string {
  if (!date) return "—";

  const [year, month, day] = date.split("-");
  if (!year || !month || !day) return date;

  return `${day}/${month}/${year}`;
}

function formatMinutes(minutes: number | undefined): string {
  const safeMinutes = Number.isFinite(minutes ?? 0)
    ? Math.max(0, Math.round(minutes ?? 0))
    : 0;

  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;

  return `${hours}h${String(mins).padStart(2, "0")}`;
}

function hoursDecimal(minutes: number | undefined): number {
  return Number(((minutes ?? 0) / 60).toFixed(1));
}

function sumNumber(flights: Flight[], key: keyof Flight): number {
  return flights.reduce((total, flight) => {
    const value = flight[key];
    return total + (typeof value === "number" ? value : 0);
  }, 0);
}

function uniqueSorted(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter(Boolean) as string[])).sort((a, b) =>
    a.localeCompare(b),
  );
}

function simpleHash(value: string): string {
  let hash = 0;

  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
}

function flightDocumentId(row: FlightInsert): string {
  // Stable duplicate key:
  // These fields identify the flight itself.
  // If you later correct total time, PIC time, landings or remarks,
  // the same Firestore document is updated instead of creating a duplicate.
  const key = [
    row.date,
    row.registration,
    row.departure_airport_name,
    row.off_block,
    row.arrival_airport_name,
    row.on_block,
  ]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .join("|");

  return `flight_${simpleHash(key)}`;
}

function aircraftFamily(registration: string | null | undefined) {
  if (!registration) return "—";
  if (registration.startsWith("CS-")) return "Tecnam";
  if (registration.startsWith("OE-")) return "Piper";
  return "Outro";
}

function mapCsvRowToFlight(row: CsvRow): FlightInsert {
  return {
    date: parseDateDMY(row.date),
    departure_airport_name: cleanText(row.departure_airport_name),
    off_block: cleanText(row.off_block),
    arrival_airport_name: cleanText(row.arrival_airport_name),
    on_block: cleanText(row.on_block),

    type_of_aircraft: cleanText(row.type_of_aircraft),
    registration: cleanText(row.registration),
    name_of_pilot_in_command: cleanText(row.name_of_pilot_in_command),

    total_minutes: timeToMinutes(row.total),
    day_minutes: timeToMinutes(row.day),
    night_minutes: timeToMinutes(row.night),

    single_engine_vfr_minutes: timeToMinutes(row.single_engine_vfr),
    single_engine_ifr_minutes: timeToMinutes(row.single_engine_ifr),
    multi_engine_vfr_minutes: timeToMinutes(row.multi_engine_vfr),
    multi_engine_ifr_minutes: timeToMinutes(row.multi_engine_ifr),

    pilot_in_command_minutes: timeToMinutes(row.pilot_in_command_time),
    co_pilot_minutes: timeToMinutes(row.co_pilot),
    multi_pilot_minutes: timeToMinutes(row.multi_pilot),
    flight_instructor_minutes: timeToMinutes(row.flight_instructor),
    dual_minutes: timeToMinutes(row.dual),

    synthetic_training_minutes: timeToMinutes(row.synthetic_training),
    instructor_synthetic_training_minutes: timeToMinutes(
      row.instructor_synthetic_training,
    ),

    landings_day: numberOrZero(row.landings_day),
    landings_night: numberOrZero(row.landings_night),

    remarks_and_endorsements: cleanText(row.remarks_and_endorsements),
    include_in_ftl: booleanOrNull(row.include_in_ftl),
    if_time_minutes: timeToMinutes(row.if_time),

    raw: row,
    created_at: new Date().toISOString(),
  };
}

function groupHours(
  flights: Flight[],
  getLabel: (flight: Flight) => string | null | undefined,
  getMinutes: (flight: Flight) => number,
  limit = 10,
): ChartRow[] {
  const map = new Map<string, number>();

  for (const flight of flights) {
    const label = getLabel(flight) || "—";
    map.set(label, (map.get(label) ?? 0) + getMinutes(flight));
  }

  return [...map.entries()]
    .map(([label, minutes]) => ({
      label,
      horas: hoursDecimal(minutes),
    }))
    .filter((row) => (row.horas ?? 0) > 0)
    .sort((a, b) => (b.horas ?? 0) - (a.horas ?? 0))
    .slice(0, limit);
}

function Button({
  children,
  onClick,
  variant = "primary",
  disabled = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
}) {
  const classes = {
    primary: "bg-slate-950 text-white hover:bg-slate-800 border-slate-950",
    secondary: "bg-white text-slate-950 hover:bg-slate-50 border-slate-200",
    danger: "bg-white text-red-700 hover:bg-red-50 border-red-200",
    ghost: "bg-transparent text-slate-600 hover:bg-slate-100 border-transparent",
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${classes[variant]}`}
    >
      {children}
    </button>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
      {children}
    </span>
  );
}

function SelectField({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-200/60"
    >
      {children}
    </select>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-5 flex items-center justify-between">
        <p className="text-sm text-slate-500">{title}</p>
        <div className="text-slate-400">{icon}</div>
      </div>

      <p className="text-3xl font-semibold tracking-tight text-slate-950">
        {value}
      </p>

      <p className="mt-2 text-sm text-slate-500">{subtitle}</p>
    </article>
  );
}

function MiniMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        ) : null}
      </div>

      {children}
    </section>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
      Sem dados suficientes.
    </div>
  );
}

function tooltipStyle() {
  return {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    color: "#0f172a",
    boxShadow: "0 16px 40px rgba(15,23,42,0.10)",
  };
}

function SimpleBarChart({
  data,
  dataKey = "horas",
  suffix = "h",
}: {
  data: ChartRow[];
  dataKey?: keyof ChartRow;
  suffix?: string;
}) {
  if (data.length === 0) return <EmptyChart />;

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 44, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="label"
            tick={{ fill: "#64748b", fontSize: 12 }}
            angle={-25}
            textAnchor="end"
            interval={0}
          />
          <YAxis tick={{ fill: "#64748b", fontSize: 12 }} />
          <Tooltip
            cursor={{ fill: "#f8fafc" }}
            contentStyle={tooltipStyle()}
            formatter={(value) => [`${value}${suffix}`, ""]}
          />
          <Bar dataKey={dataKey as string} fill="#0f172a" radius={[8, 8, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function HorizontalBarChart({
  data,
  dataKey = "horas",
  suffix = "h",
}: {
  data: ChartRow[];
  dataKey?: keyof ChartRow;
  suffix?: string;
}) {
  if (data.length === 0) return <EmptyChart />;

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 20, bottom: 8, left: 42 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis type="number" tick={{ fill: "#64748b", fontSize: 12 }} />
          <YAxis
            dataKey="label"
            type="category"
            width={90}
            tick={{ fill: "#64748b", fontSize: 12 }}
          />
          <Tooltip
            cursor={{ fill: "#f8fafc" }}
            contentStyle={tooltipStyle()}
            formatter={(value) => [`${value}${suffix}`, ""]}
          />
          <Bar dataKey={dataKey as string} fill="#0f172a" radius={[0, 8, 8, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function MonthlyChart({ data }: { data: ChartRow[] }) {
  if (data.length === 0) return <EmptyChart />;

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 12 }} />
          <YAxis tick={{ fill: "#64748b", fontSize: 12 }} />
          <Tooltip cursor={{ fill: "#f8fafc" }} contentStyle={tooltipStyle()} />
          <Bar dataKey="voo" stackId="a" name="Voo" fill="#0f172a" />
          <Bar
            dataKey="simulador"
            stackId="a"
            name="Simulador"
            fill="#94a3b8"
            radius={[8, 8, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CumulativeChart({ data }: { data: ChartRow[] }) {
  if (data.length === 0) return <EmptyChart />;

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 12 }} />
          <YAxis tick={{ fill: "#64748b", fontSize: 12 }} />
          <Tooltip contentStyle={tooltipStyle()} />
          <Area
            type="monotone"
            dataKey="total"
            name="Horas acumuladas"
            stroke="#0f172a"
            fill="#e2e8f0"
            strokeWidth={2.5}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function MonthlyFlightsChart({ data }: { data: ChartRow[] }) {
  if (data.length === 0) return <EmptyChart />;

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 12 }} />
          <YAxis tick={{ fill: "#64748b", fontSize: 12 }} />
          <Tooltip contentStyle={tooltipStyle()} />
          <Line
            type="monotone"
            dataKey="voos"
            name="Voos"
            stroke="#0f172a"
            strokeWidth={2.5}
            dot={{ r: 3 }}
          />
          <Line
            type="monotone"
            dataKey="aterragens"
            name="Aterragens"
            stroke="#64748b"
            strokeWidth={2.5}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function PieStats({ data }: { data: ChartRow[] }) {
  const filtered = data.filter((item) => (item.value ?? 0) > 0);

  if (filtered.length === 0) return <EmptyChart />;

  return (
    <div className="grid gap-4 md:grid-cols-[220px_1fr] md:items-center">
      <div className="h-56 w-full">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={filtered}
              innerRadius={58}
              outerRadius={88}
              paddingAngle={3}
              dataKey="value"
              nameKey="label"
            >
              {filtered.map((entry, index) => (
                <Cell key={entry.label} fill={chartColors[index % chartColors.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle()} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="space-y-2">
        {filtered.map((item, index) => (
          <div
            key={item.label}
            className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm"
          >
            <span className="flex items-center gap-2 text-slate-600">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: chartColors[index % chartColors.length] }}
              />
              {item.label}
            </span>
            <span className="font-medium text-slate-950">
              {formatMinutes(item.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8">
        <Plane className="mb-5 text-slate-400" size={28} />
        <h1 className="text-2xl font-semibold text-slate-950">A carregar</h1>
      </section>
    </main>
  );
}

function LoginScreen({
  status,
  loading,
  onLogin,
}: {
  status: string;
  loading: boolean;
  onLogin: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-10">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8">
        <div className="mb-8 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
          <Plane size={22} />
        </div>

        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
          Flight Stats
        </h1>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Estado
          </p>
          <p className="mt-2 text-sm text-slate-700">{status}</p>
        </div>

        <button
          onClick={onLogin}
          disabled={loading}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "A entrar..." : "Entrar com Google"}
          <ArrowRight size={16} />
        </button>
      </section>
    </main>
  );
}

export default function Home() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const [status, setStatus] = useState("A carregar...");
  const [loading, setLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const [flights, setFlights] = useState<Flight[]>([]);

  const [selectedYear, setSelectedYear] = useState("all");
  const [selectedRegistration, setSelectedRegistration] = useState("all");
  const [selectedAircraft, setSelectedAircraft] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (!currentUser) {
        setStatus("Sem sessão iniciada.");
        setLoading(false);
        setAuthReady(true);
        return;
      }

      if (currentUser.email !== allowedEmail) {
        setStatus("Esta app está limitada ao email autorizado.");
        setLoading(false);
        setAuthReady(true);
        return;
      }

      setStatus("Sessão Google iniciada.");
      await loadFlights(currentUser);
      setAuthReady(true);
    });

    return () => unsubscribe();

    // This effect intentionally subscribes once to Firebase Auth.
    // loadFlights receives currentUser directly, so it does not depend on stale user state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleGoogleSignIn() {
    setLoading(true);
    setStatus("A redirecionar para login Google...");

    try {
      const provider = new GoogleAuthProvider();

      provider.setCustomParameters({
        prompt: "select_account",
      });

      await signInWithRedirect(auth, provider);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erro desconhecido.";

      setStatus(`Erro no login Google: ${message}`);
      setLoading(false);
    }
  }

  async function handleSignOut() {
    setLoading(true);
    setStatus("A terminar sessão...");

    try {
      await signOut(auth);
      setUser(null);
      setFlights([]);
      setStatus("Sessão terminada.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erro desconhecido.";

      setStatus(`Erro ao sair: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadFlights(currentUser = user) {
    if (!currentUser) return;

    setLoading(true);
    setStatus("A carregar voos...");

    try {
      const flightsQuery = query(
        getFlightsCollection(currentUser.uid),
        orderBy("date", "desc"),
      );

      const snapshot = await getDocs(flightsQuery);

      const loadedFlights = snapshot.docs.map((documentSnapshot) => ({
        id: documentSnapshot.id,
        ...(documentSnapshot.data() as Omit<Flight, "id">),
      }));

      setFlights(loadedFlights);
      setStatus(`${loadedFlights.length} registo(s) carregado(s).`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erro desconhecido.";

      setStatus(`Erro ao carregar voos: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  async function deleteAllFlights() {
    if (!user) return;

    const confirmed = window.confirm(
      "Isto vai apagar todos os voos guardados nesta app. Queres continuar?",
    );

    if (!confirmed) return;

    setLoading(true);
    setStatus("A apagar voos...");

    try {
      const snapshot = await getDocs(getFlightsCollection(user.uid));

      for (let i = 0; i < snapshot.docs.length; i += 450) {
        const batch = writeBatch(db);
        const chunk = snapshot.docs.slice(i, i + 450);

        chunk.forEach((documentSnapshot) => {
          batch.delete(documentSnapshot.ref);
        });

        await batch.commit();
      }

      setFlights([]);
      setStatus("Todos os voos foram apagados.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erro desconhecido.";

      setStatus(`Erro ao apagar voos: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  async function appendFlightsWithRows(rows: FlightInsert[]) {
    if (!user) throw new Error("Tens de iniciar sessão primeiro.");

    for (let i = 0; i < rows.length; i += 450) {
      const batch = writeBatch(db);
      const chunk = rows.slice(i, i + 450);

      chunk.forEach((row) => {
        const documentId = flightDocumentId(row);
        const flightRef = doc(getFlightsCollection(user.uid), documentId);

        batch.set(
          flightRef,
          {
            ...row,
            updated_at: serverTimestamp(),
          },
          { merge: true },
        );
      });

      await batch.commit();
    }
  }

  async function handleCsvUpload(file: File) {
    if (!user) {
      setStatus("Tens de iniciar sessão primeiro.");
      return;
    }

    setIsImporting(true);
    setStatus("A ler CSV...");

    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (result) => {
        try {
          const parsedRows = result.data
            .map(mapCsvRowToFlight)
            .filter(
              (row) =>
                row.date ||
                row.total_minutes > 0 ||
                row.synthetic_training_minutes > 0 ||
                row.remarks_and_endorsements,
            );

          if (parsedRows.length === 0) {
            setStatus("Não encontrei linhas válidas no CSV.");
            return;
          }

          setStatus(`A acrescentar/atualizar ${parsedRows.length} voo(s)...`);

          await appendFlightsWithRows(parsedRows);
          await loadFlights(user);

          setStatus(`${parsedRows.length} voo(s) acrescentado(s) ou atualizado(s).`);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Erro desconhecido.";

          setStatus(`Erro ao importar CSV: ${message}`);
        } finally {
          setIsImporting(false);
        }
      },
      error: (error) => {
        setStatus(`Erro ao ler CSV: ${error.message}`);
        setIsImporting(false);
      },
    });
  }

  function clearFilters() {
    setSelectedYear("all");
    setSelectedRegistration("all");
    setSelectedAircraft("all");
    setSearch("");
  }

  function exportFilteredCsv() {
    const rows = filteredFlights.map((flight) => ({
      date: flight.date,
      departure_airport_name: flight.departure_airport_name,
      arrival_airport_name: flight.arrival_airport_name,
      type_of_aircraft: flight.type_of_aircraft,
      registration: flight.registration,
      name_of_pilot_in_command: flight.name_of_pilot_in_command,
      total: formatMinutes(flight.total_minutes),
      pic_time: formatMinutes(flight.pilot_in_command_minutes),
      dual: formatMinutes(flight.dual_minutes),
      night: formatMinutes(flight.night_minutes),
      landings: (flight.landings_day ?? 0) + (flight.landings_night ?? 0),
    }));

    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "flight-stats-filtered.csv";
    link.click();

    URL.revokeObjectURL(url);
  }

  const filterOptions = useMemo(() => {
    const years = uniqueSorted(
      flights.map((flight) => (flight.date ? flight.date.slice(0, 4) : null)),
    ).reverse();

    const registrations = uniqueSorted(
      flights.map((flight) => flight.registration),
    );

    const aircraft = uniqueSorted(flights.map((flight) => flight.type_of_aircraft));

    return {
      years,
      registrations,
      aircraft,
    };
  }, [flights]);

  const filteredFlights = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return flights.filter((flight) => {
      const matchesYear =
        selectedYear === "all" || flight.date?.startsWith(selectedYear);

      const matchesRegistration =
        selectedRegistration === "all" ||
        flight.registration === selectedRegistration;

      const matchesAircraft =
        selectedAircraft === "all" || flight.type_of_aircraft === selectedAircraft;

      const searchableText = [
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

      const matchesSearch =
        !normalizedSearch || searchableText.includes(normalizedSearch);

      return matchesYear && matchesRegistration && matchesAircraft && matchesSearch;
    });
  }, [flights, selectedYear, selectedRegistration, selectedAircraft, search]);

  const stats = useMemo(() => {
    const flightMinutes = sumNumber(filteredFlights, "total_minutes");
    const syntheticMinutes = sumNumber(
      filteredFlights,
      "synthetic_training_minutes",
    );

    const dayMinutes = sumNumber(filteredFlights, "day_minutes");
    const nightMinutes = sumNumber(filteredFlights, "night_minutes");

    const picMinutes = sumNumber(filteredFlights, "pilot_in_command_minutes");
    const dualMinutes = sumNumber(filteredFlights, "dual_minutes");

    const vfrMinutes =
      sumNumber(filteredFlights, "single_engine_vfr_minutes") +
      sumNumber(filteredFlights, "multi_engine_vfr_minutes");

    const ifrMinutes =
      sumNumber(filteredFlights, "single_engine_ifr_minutes") +
      sumNumber(filteredFlights, "multi_engine_ifr_minutes");

    const ifTimeMinutes = sumNumber(filteredFlights, "if_time_minutes");

    const landingsDay = sumNumber(filteredFlights, "landings_day");
    const landingsNight = sumNumber(filteredFlights, "landings_night");

    const actualFlights = filteredFlights.filter(
      (flight) => (flight.total_minutes ?? 0) > 0,
    );

    const syntheticSessions = filteredFlights.filter(
      (flight) => (flight.synthetic_training_minutes ?? 0) > 0,
    );

    const sortedByDate = [...filteredFlights]
      .filter((flight) => flight.date)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    const firstDate = sortedByDate[0]?.date ?? null;
    const lastDate = sortedByDate[sortedByDate.length - 1]?.date ?? null;

    const aircraftCount = new Set(
      filteredFlights.map((flight) => flight.type_of_aircraft).filter(Boolean),
    ).size;

    const registrationCount = new Set(
      filteredFlights.map((flight) => flight.registration).filter(Boolean),
    ).size;

    const airportCount = new Set(
      filteredFlights
        .flatMap((flight) => [
          flight.departure_airport_name,
          flight.arrival_airport_name,
        ])
        .filter(Boolean),
    ).size;

    const today = new Date();
    const last90Cutoff = new Date(today);
    last90Cutoff.setDate(today.getDate() - 90);

    const last12Cutoff = new Date(today);
    last12Cutoff.setMonth(today.getMonth() - 12);

    const last90Flights = filteredFlights.filter((flight) => {
      if (!flight.date) return false;
      return new Date(flight.date) >= last90Cutoff;
    });

    const last12Flights = filteredFlights.filter((flight) => {
      if (!flight.date) return false;
      return new Date(flight.date) >= last12Cutoff;
    });

    return {
      flightMinutes,
      syntheticMinutes,
      totalActivityMinutes: flightMinutes + syntheticMinutes,

      dayMinutes,
      nightMinutes,
      picMinutes,
      dualMinutes,

      vfrMinutes,
      ifrMinutes,
      ifTimeMinutes,

      landingsDay,
      landingsNight,
      landingsTotal: landingsDay + landingsNight,

      actualFlightCount: actualFlights.length,
      syntheticSessionCount: syntheticSessions.length,
      totalRows: filteredFlights.length,

      firstDate,
      lastDate,

      aircraftCount,
      registrationCount,
      airportCount,

      last90Minutes: sumNumber(last90Flights, "total_minutes"),
      last90Flights: last90Flights.filter((flight) => (flight.total_minutes ?? 0) > 0).length,
      last12Minutes: sumNumber(last12Flights, "total_minutes"),
      last12Flights: last12Flights.filter((flight) => (flight.total_minutes ?? 0) > 0).length,
    };
  }, [filteredFlights]);

  const charts = useMemo(() => {
    const monthlyMap = new Map<
      string,
      {
        label: string;
        voo: number;
        simulador: number;
        total: number;
        voos: number;
        aterragens: number;
      }
    >();

    for (const flight of filteredFlights) {
      if (!flight.date) continue;

      const month = flight.date.slice(0, 7);
      const current =
        monthlyMap.get(month) ??
        {
          label: month,
          voo: 0,
          simulador: 0,
          total: 0,
          voos: 0,
          aterragens: 0,
        };

      current.voo += hoursDecimal(flight.total_minutes);
      current.simulador += hoursDecimal(flight.synthetic_training_minutes);
      current.total += hoursDecimal(
        (flight.total_minutes ?? 0) + (flight.synthetic_training_minutes ?? 0),
      );
      current.voos += (flight.total_minutes ?? 0) > 0 ? 1 : 0;
      current.aterragens += (flight.landings_day ?? 0) + (flight.landings_night ?? 0);

      monthlyMap.set(month, current);
    }

    const byMonth = [...monthlyMap.values()].sort((a, b) =>
      a.label.localeCompare(b.label),
    );

    const cumulative: ChartRow[] = [];
    let runningMinutes = 0;

    for (const flight of [...filteredFlights]
      .filter((item) => item.date)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
      runningMinutes +=
        (flight.total_minutes ?? 0) + (flight.synthetic_training_minutes ?? 0);

      cumulative.push({
        label: formatDate(flight.date).slice(0, 5),
        total: hoursDecimal(runningMinutes),
      });
    }

    const byRegistration = groupHours(
      filteredFlights,
      (flight) => flight.registration,
      (flight) =>
        (flight.total_minutes ?? 0) + (flight.synthetic_training_minutes ?? 0),
      10,
    );

    const byAircraft = groupHours(
      filteredFlights,
      (flight) => flight.type_of_aircraft,
      (flight) =>
        (flight.total_minutes ?? 0) + (flight.synthetic_training_minutes ?? 0),
      10,
    );

    const byRoute = groupHours(
      filteredFlights,
      (flight) => {
        const departure = flight.departure_airport_name || "—";
        const arrival = flight.arrival_airport_name || "—";
        if (departure === "—" && arrival === "—") return "Simulador";
        return `${departure} → ${arrival}`;
      },
      (flight) =>
        (flight.total_minutes ?? 0) + (flight.synthetic_training_minutes ?? 0),
      10,
    );

    const airportMap = new Map<string, number>();

    for (const flight of filteredFlights) {
      if (flight.departure_airport_name) {
        airportMap.set(
          flight.departure_airport_name,
          (airportMap.get(flight.departure_airport_name) ?? 0) + 1,
        );
      }

      if (flight.arrival_airport_name) {
        airportMap.set(
          flight.arrival_airport_name,
          (airportMap.get(flight.arrival_airport_name) ?? 0) + 1,
        );
      }
    }

    const byAirport = [...airportMap.entries()]
      .map(([label, movimentos]) => ({ label, movimentos }))
      .sort((a, b) => b.movimentos - a.movimentos)
      .slice(0, 10);

    const landingsMap = new Map<string, number>();

    for (const flight of filteredFlights) {
      const label = flight.registration || "—";
      const current = landingsMap.get(label) ?? 0;

      landingsMap.set(
        label,
        current + (flight.landings_day ?? 0) + (flight.landings_night ?? 0),
      );
    }

    const landingsByRegistration = [...landingsMap.entries()]
      .map(([label, aterragens]) => ({ label, aterragens }))
      .filter((row) => row.aterragens > 0)
      .sort((a, b) => b.aterragens - a.aterragens)
      .slice(0, 10);

    const familyMap = new Map<string, number>();

    for (const flight of filteredFlights) {
      const family = aircraftFamily(flight.registration);
      familyMap.set(
        family,
        (familyMap.get(family) ?? 0) +
          (flight.total_minutes ?? 0) +
          (flight.synthetic_training_minutes ?? 0),
      );
    }

    const familyDistribution = [...familyMap.entries()]
      .map(([label, value]) => ({ label, value }))
      .filter((item) => item.value > 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    const timeDistribution = [
      { label: "PIC", value: stats.picMinutes },
      { label: "Dual", value: stats.dualMinutes },
      { label: "Simulador", value: stats.syntheticMinutes },
      { label: "Noite", value: stats.nightMinutes },
      { label: "IFR", value: stats.ifrMinutes },
    ];

    return {
      byMonth,
      cumulative,
      byRegistration,
      byAircraft,
      byRoute,
      byAirport,
      landingsByRegistration,
      familyDistribution,
      timeDistribution,
    };
  }, [filteredFlights, stats.picMinutes, stats.dualMinutes, stats.syntheticMinutes, stats.nightMinutes, stats.ifrMinutes]);

  const isAllowedUser = user?.email === allowedEmail;

  if (!authReady) return <LoadingScreen />;

  if (!isAllowedUser) {
    return (
      <LoginScreen
        status={status}
        loading={loading}
        onLogin={handleGoogleSignIn}
      />
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-5 md:px-6 md:py-8">
        <header className="mb-6 flex flex-col gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white">
              <Plane size={22} />
            </div>

            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-950">
                Flight Stats
              </h1>
              <p className="text-sm text-slate-500">{user.email}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => loadFlights()} variant="secondary" disabled={loading}>
              <RefreshCw size={16} />
              Atualizar
            </Button>

            <Button onClick={handleSignOut} variant="secondary" disabled={loading}>
              <LogOut size={16} />
              Sair
            </Button>
          </div>
        </header>

        <section className="mb-6 grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="grid gap-4 md:grid-cols-4">
            <MiniMetric label="Período" value={`${formatDate(stats.firstDate)} — ${formatDate(stats.lastDate)}`} />
            <MiniMetric label="Últimos 90 dias" value={`${formatMinutes(stats.last90Minutes)} · ${stats.last90Flights} voos`} />
            <MiniMetric label="Últimos 12 meses" value={`${formatMinutes(stats.last12Minutes)} · ${stats.last12Flights} voos`} />
            <MiniMetric label="Registos" value={`${filteredFlights.length} / ${flights.length}`} />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <label className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800">
              <Upload size={16} />
              {isImporting ? "A importar..." : "Importar CSV"}
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                disabled={isImporting}
                onChange={(event) => {
                  const file = event.target.files?.[0];

                  if (file) {
                    handleCsvUpload(file);
                  }

                  event.target.value = "";
                }}
              />
            </label>

            <p className="mt-3 text-sm leading-6 text-slate-500">{status}</p>
          </div>
        </section>

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-5 flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div>
              <h3 className="flex items-center gap-2 text-base font-semibold text-slate-950">
                <Search size={17} />
                Filtros
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {filteredFlights.length} de {flights.length} registo(s).
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={clearFilters} variant="ghost">
                Limpar
              </Button>

              <Button
                onClick={exportFilteredCsv}
                variant="secondary"
                disabled={filteredFlights.length === 0}
              >
                <Download size={16} />
                Exportar
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label>
              <Label>Ano</Label>
              <SelectField value={selectedYear} onChange={setSelectedYear}>
                <option value="all">Todos os anos</option>
                {filterOptions.years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </SelectField>
            </label>

            <label>
              <Label>Matrícula</Label>
              <SelectField
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
            </label>

            <label>
              <Label>Aeronave</Label>
              <SelectField value={selectedAircraft} onChange={setSelectedAircraft}>
                <option value="all">Todos os tipos</option>
                {filterOptions.aircraft.map((aircraft) => (
                  <option key={aircraft} value={aircraft}>
                    {aircraft}
                  </option>
                ))}
              </SelectField>
            </label>

            <label>
              <Label>Pesquisa</Label>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="rota, aeroporto, PIC..."
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-200/60"
              />
            </label>
          </div>
        </section>

        <section className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Horas de voo"
            value={formatMinutes(stats.flightMinutes)}
            subtitle={`${stats.actualFlightCount} voos reais`}
            icon={<Clock3 size={20} />}
          />

          <StatCard
            title="Simulador"
            value={formatMinutes(stats.syntheticMinutes)}
            subtitle={`${stats.syntheticSessionCount} sessões`}
            icon={<Gauge size={20} />}
          />

          <StatCard
            title="PIC"
            value={formatMinutes(stats.picMinutes)}
            subtitle="Pilot in Command"
            icon={<UserRound size={20} />}
          />

          <StatCard
            title="Aterragens"
            value={String(stats.landingsTotal)}
            subtitle={`${stats.landingsDay} dia · ${stats.landingsNight} noite`}
            icon={<PlaneLanding size={20} />}
          />
        </section>

        <section className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Total atividade"
            value={formatMinutes(stats.totalActivityMinutes)}
            subtitle="Voo + simulador"
            icon={<CalendarDays size={20} />}
          />

          <StatCard
            title="Noite"
            value={formatMinutes(stats.nightMinutes)}
            subtitle={`${formatMinutes(stats.dayMinutes)} de dia`}
            icon={<Moon size={20} />}
          />

          <StatCard
            title="IFR / VFR"
            value={`${formatMinutes(stats.ifrMinutes)} / ${formatMinutes(stats.vfrMinutes)}`}
            subtitle={`IF time: ${formatMinutes(stats.ifTimeMinutes)}`}
            icon={<Plane size={20} />}
          />

          <StatCard
            title="Aeródromos"
            value={String(stats.airportCount)}
            subtitle={`${stats.aircraftCount} tipos · ${stats.registrationCount} matrículas`}
            icon={<CalendarDays size={20} />}
          />
        </section>

        <section className="mb-6 grid gap-5 xl:grid-cols-2">
          <Panel title="Horas por mês">
            <MonthlyChart data={charts.byMonth} />
          </Panel>

          <Panel title="Voos e aterragens por mês">
            <MonthlyFlightsChart data={charts.byMonth} />
          </Panel>

          <Panel title="Horas acumuladas">
            <CumulativeChart data={charts.cumulative} />
          </Panel>

          <Panel title="Distribuição de tempo">
            <PieStats data={charts.timeDistribution} />
          </Panel>

          <Panel title="Horas por matrícula">
            <HorizontalBarChart data={charts.byRegistration} />
          </Panel>

          <Panel title="Horas por rota">
            <HorizontalBarChart data={charts.byRoute} />
          </Panel>

          <Panel title="Movimentos por aeródromo">
            <HorizontalBarChart
              data={charts.byAirport}
              dataKey="movimentos"
              suffix=""
            />
          </Panel>

          <Panel title="Família de aeronave">
            <PieStats data={charts.familyDistribution} />
          </Panel>

          <Panel title="Horas por tipo">
            <SimpleBarChart data={charts.byAircraft} />
          </Panel>

          <Panel title="Aterragens por matrícula">
            <SimpleBarChart
              data={charts.landingsByRegistration}
              dataKey="aterragens"
              suffix=""
            />
          </Panel>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-5 flex flex-col justify-between gap-3 md:flex-row md:items-end">
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                Logbook
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Últimos registos filtrados.
              </p>
            </div>

            <Button onClick={deleteAllFlights} variant="danger" disabled={loading}>
              <Trash2 size={16} />
              Apagar tudo
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-3 font-medium">Data</th>
                  <th className="px-3 py-3 font-medium">Rota</th>
                  <th className="px-3 py-3 font-medium">Tipo</th>
                  <th className="px-3 py-3 font-medium">Matrícula</th>
                  <th className="px-3 py-3 font-medium">Família</th>
                  <th className="px-3 py-3 font-medium">PIC</th>
                  <th className="px-3 py-3 font-medium">Total</th>
                  <th className="px-3 py-3 font-medium">PIC time</th>
                  <th className="px-3 py-3 font-medium">Dual</th>
                  <th className="px-3 py-3 font-medium">Noite</th>
                  <th className="px-3 py-3 font-medium">LDG</th>
                </tr>
              </thead>

              <tbody>
                {filteredFlights.slice(0, 80).map((flight) => (
                  <tr
                    key={flight.id}
                    className="border-b border-slate-100 text-slate-700 transition hover:bg-slate-50"
                  >
                    <td className="px-3 py-3 font-medium text-slate-950">
                      {formatDate(flight.date)}
                    </td>

                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span>{flight.departure_airport_name || "—"}</span>
                        <ArrowRight size={14} className="text-slate-300" />
                        <span>{flight.arrival_airport_name || "—"}</span>
                      </div>
                    </td>

                    <td className="px-3 py-3">{flight.type_of_aircraft || "—"}</td>

                    <td className="px-3 py-3">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                        {flight.registration || "—"}
                      </span>
                    </td>

                    <td className="px-3 py-3 text-slate-500">
                      {aircraftFamily(flight.registration)}
                    </td>

                    <td className="px-3 py-3">
                      {flight.name_of_pilot_in_command || "—"}
                    </td>

                    <td className="px-3 py-3 font-medium text-slate-950">
                      {formatMinutes(flight.total_minutes)}
                    </td>

                    <td className="px-3 py-3">
                      {formatMinutes(flight.pilot_in_command_minutes)}
                    </td>

                    <td className="px-3 py-3">
                      {formatMinutes(flight.dual_minutes)}
                    </td>

                    <td className="px-3 py-3">
                      {formatMinutes(flight.night_minutes)}
                    </td>

                    <td className="px-3 py-3">
                      {(flight.landings_day ?? 0) + (flight.landings_night ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {filteredFlights.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center">
                <p className="text-sm text-slate-500">
                  Não há voos para os filtros atuais.
                </p>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
