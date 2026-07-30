import "server-only";

import type {
  Flight,
  FlightLoggerProfile,
  FlightStatsResponse,
} from "@/lib/flight-types";

const FLIGHTLOGGER_ENDPOINT = "https://api.flightlogger.net/graphql";
const PAGE_SIZE = 100;
const MAX_PAGES = 100;

const LOGBOOK_QUERY = `
  query FlightStats($first: Int!, $after: String) {
    myFlightLogger {
      firstName
      lastName
      callSign
      logbookEntries(first: $first, after: $after) {
        nodes {
          arrivalAirportName
          coPilotSeconds
          daySeconds
          departureAirportName
          dualSeconds
          flightInstructorSeconds
          id
          ifTimeSeconds
          includeInFtl
          instructorSyntheticTrainingSeconds
          landingsDay
          landingsNight
          multiEngineIfrSeconds
          multiEngineVfrSeconds
          multiPilotSeconds
          nameOfPilotInCommand
          nightSeconds
          offBlock
          onBlock
          pilotInCommandSeconds
          registration
          remarksAndEndorsements
          singleEngineIfrSeconds
          singleEngineVfrSeconds
          syntheticTrainingSeconds
          totalSeconds
          typeOfAircraft
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  }
`;

type FlightLoggerLogbookEntry = {
  arrivalAirportName?: string | null;
  coPilotSeconds?: number | null;
  daySeconds?: number | null;
  departureAirportName?: string | null;
  dualSeconds?: number | null;
  flightInstructorSeconds?: number | null;
  id: string | number;
  ifTimeSeconds?: number | null;
  includeInFtl?: boolean | null;
  instructorSyntheticTrainingSeconds?: number | null;
  landingsDay?: number | null;
  landingsNight?: number | null;
  multiEngineIfrSeconds?: number | null;
  multiEngineVfrSeconds?: number | null;
  multiPilotSeconds?: number | null;
  nameOfPilotInCommand?: string | null;
  nightSeconds?: number | null;
  offBlock?: string | null;
  onBlock?: string | null;
  pilotInCommandSeconds?: number | null;
  registration?: string | null;
  remarksAndEndorsements?: string | null;
  singleEngineIfrSeconds?: number | null;
  singleEngineVfrSeconds?: number | null;
  syntheticTrainingSeconds?: number | null;
  totalSeconds?: number | null;
  typeOfAircraft?: string | null;
};

type FlightLoggerPage = {
  data?: {
    myFlightLogger?: {
      firstName: string;
      lastName: string;
      callSign: string;
      logbookEntries?: {
        nodes?: Array<FlightLoggerLogbookEntry | null> | null;
        pageInfo?: {
          endCursor?: string | null;
          hasNextPage?: boolean;
        } | null;
      } | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

function cleanText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function secondsToMinutes(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? Number.NaN)) return 0;
  return Math.max(0, Math.round((value ?? 0) / 60));
}

function cleanRegistration(value: unknown): string | null {
  const text = cleanText(value);
  return text ? text.toUpperCase() : null;
}

export function normalizeAircraftModel(value: unknown): string | null {
  const text = cleanText(value);
  if (!text) return null;

  const upper = text
    .toUpperCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  const pa28 = upper.replace(/^PIPER\s+/, "");
  if (/^PA[- ]?28(?:[- ]|$)/.test(pa28) && !/^PA[- ]?28R/.test(pa28)) {
    return "PA-28";
  }

  const p2008 = upper.replace(/^TECNAM\s+/, "");
  if (/^P[- ]?2008(?:\s|$)/.test(p2008)) {
    return "P2008";
  }

  return upper;
}

function mapLogbookEntry(entry: FlightLoggerLogbookEntry): Flight {
  const offBlock = cleanText(entry.offBlock);
  const onBlock = cleanText(entry.onBlock);
  const registration = cleanRegistration(entry.registration);
  const normalizedModel = normalizeAircraftModel(entry.typeOfAircraft);
  const inferredModel = registration?.startsWith("OE-")
    ? "PA-28"
    : registration?.startsWith("CS-")
      ? "P2008"
      : null;

  return {
    id: String(entry.id),
    date: offBlock?.slice(0, 10) ?? null,
    departure_airport_name: cleanText(entry.departureAirportName),
    off_block: offBlock,
    arrival_airport_name: cleanText(entry.arrivalAirportName),
    on_block: onBlock,
    type_of_aircraft: inferredModel ?? normalizedModel,
    registration,
    name_of_pilot_in_command: cleanText(entry.nameOfPilotInCommand),
    total_minutes: secondsToMinutes(entry.totalSeconds),
    day_minutes: secondsToMinutes(entry.daySeconds),
    night_minutes: secondsToMinutes(entry.nightSeconds),
    single_engine_vfr_minutes: secondsToMinutes(entry.singleEngineVfrSeconds),
    single_engine_ifr_minutes: secondsToMinutes(entry.singleEngineIfrSeconds),
    multi_engine_vfr_minutes: secondsToMinutes(entry.multiEngineVfrSeconds),
    multi_engine_ifr_minutes: secondsToMinutes(entry.multiEngineIfrSeconds),
    pilot_in_command_minutes: secondsToMinutes(entry.pilotInCommandSeconds),
    co_pilot_minutes: secondsToMinutes(entry.coPilotSeconds),
    multi_pilot_minutes: secondsToMinutes(entry.multiPilotSeconds),
    flight_instructor_minutes: secondsToMinutes(entry.flightInstructorSeconds),
    dual_minutes: secondsToMinutes(entry.dualSeconds),
    synthetic_training_minutes: secondsToMinutes(entry.syntheticTrainingSeconds),
    instructor_synthetic_training_minutes: secondsToMinutes(
      entry.instructorSyntheticTrainingSeconds,
    ),
    landings_day: Math.max(0, entry.landingsDay ?? 0),
    landings_night: Math.max(0, entry.landingsNight ?? 0),
    remarks_and_endorsements: cleanText(entry.remarksAndEndorsements),
    include_in_ftl: entry.includeInFtl ?? null,
    if_time_minutes: secondsToMinutes(entry.ifTimeSeconds),
  };
}

async function fetchPage(
  token: string,
  after: string | null,
): Promise<FlightLoggerPage> {
  const response = await fetch(FLIGHTLOGGER_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: LOGBOOK_QUERY,
      variables: {
        first: PAGE_SIZE,
        after,
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `FlightLogger respondeu com HTTP ${response.status}${
        body ? `: ${body.slice(0, 240)}` : ""
      }`,
    );
  }

  const payload = (await response.json()) as FlightLoggerPage;

  if (payload.errors?.length) {
    throw new Error(
      payload.errors.map((error) => error.message || "Erro GraphQL").join("; "),
    );
  }

  if (!payload.data?.myFlightLogger) {
    throw new Error(
      "O token não devolveu dados de myFlightLogger. Confirma se é um token pessoal com acesso ao logbook.",
    );
  }

  return payload;
}

export async function fetchFlightStats(): Promise<FlightStatsResponse> {
  const token = process.env.FLIGHTLOGGER_API_TOKEN?.trim();

  if (!token) {
    const error = new Error(
      "Falta configurar FLIGHTLOGGER_API_TOKEN nas variáveis de ambiente da Vercel.",
    );
    error.name = "FLIGHTLOGGER_NOT_CONFIGURED";
    throw error;
  }

  const entries: FlightLoggerLogbookEntry[] = [];
  let profile: FlightLoggerProfile | null = null;
  let after: string | null = null;
  let hasMorePages = false;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const payload = await fetchPage(token, after);
    const source = payload.data?.myFlightLogger;

    if (!source) break;

    profile ??= {
      firstName: source.firstName,
      lastName: source.lastName,
      callSign: source.callSign,
    };

    const connection = source.logbookEntries;
    const nodes = connection?.nodes ?? [];

    for (const node of nodes) {
      if (node) entries.push(node);
    }

    hasMorePages = Boolean(connection?.pageInfo?.hasNextPage);
    if (!hasMorePages) break;

    const nextCursor = connection?.pageInfo?.endCursor ?? null;
    if (!nextCursor || nextCursor === after) {
      throw new Error("A paginação do FlightLogger não avançou corretamente.");
    }

    after = nextCursor;
  }

  if (hasMorePages) {
    throw new Error(
      `O logbook excedeu o limite de ${MAX_PAGES * PAGE_SIZE} registos por sincronização.`,
    );
  }

  if (!profile) {
    throw new Error("Não foi possível obter o perfil do FlightLogger.");
  }

  const flights = entries
    .map(mapLogbookEntry)
    .sort((a, b) =>
      String(b.off_block ?? "").localeCompare(String(a.off_block ?? "")),
    );

  return {
    flights,
    profile,
    syncedAt: new Date().toISOString(),
  };
}
