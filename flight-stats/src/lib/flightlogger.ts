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

const ACCOUNT_USER_QUERY = `
  query FlightStatsUser($email: String, $searchTerm: String, $first: Int!) {
    users(email: $email, searchTerm: $searchTerm, first: $first) {
      nodes {
        id
        firstName
        lastName
        callSign
        contact {
          email
        }
      }
    }
  }
`;

const ACCOUNT_FLIGHTS_QUERY = `
  query FlightStatsAccountFlights($id: String, $first: Int!, $after: String) {
    user(id: $id) {
      id
      firstName
      lastName
      callSign
      flights(first: $first, after: $after) {
        nodes {
          aircraft {
            aircraftClass
            callSign
            model
          }
          arrivalAirport {
            name
          }
          daySeconds
          departureAirport {
            name
          }
          flightType
          ftSeconds
          id
          ifSeconds
          ifrSeconds
          landings {
            landingType
            landingTypeCount
            nightLanding
          }
          nightSeconds
          offBlock
          onBlock
          vfrSeconds
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  }
`;

type GraphQlError = {
  message?: string;
};

type GraphQlResponse<T> = {
  data?: T;
  errors?: GraphQlError[];
};

type PageInfo = {
  endCursor?: string | null;
  hasNextPage?: boolean;
};

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

type PersonalFlightLoggerData = {
  myFlightLogger?: {
    firstName: string;
    lastName: string;
    callSign: string;
    logbookEntries?: {
      nodes?: Array<FlightLoggerLogbookEntry | null> | null;
      pageInfo?: PageInfo | null;
    } | null;
  } | null;
};

type AccountUser = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  callSign?: string | null;
  contact?: {
    email?: string | null;
  } | null;
};

type AccountUserData = {
  users?: {
    nodes?: Array<AccountUser | null> | null;
  } | null;
};

type AccountLanding = {
  landingType?: "APPROACH" | "GO_AROUND" | "LANDING" | "TOUCH_AND_GO" | null;
  landingTypeCount?: number | null;
  nightLanding?: boolean | null;
};

type AccountFlight = {
  aircraft?: {
    aircraftClass?: "MULTI_ENGINE" | "SIMULATOR" | "SINGLE_ENGINE" | null;
    callSign?: string | null;
    model?: string | null;
  } | null;
  arrivalAirport?: {
    name?: string | null;
  } | null;
  daySeconds?: number | null;
  departureAirport?: {
    name?: string | null;
  } | null;
  flightType?: "DUAL" | "SIM" | "SOLO" | "SPIC" | null;
  ftSeconds?: number | null;
  id: string | number;
  ifSeconds?: number | null;
  ifrSeconds?: number | null;
  landings?: Array<AccountLanding | null> | null;
  nightSeconds?: number | null;
  offBlock?: string | null;
  onBlock?: string | null;
  vfrSeconds?: number | null;
};

type AccountFlightData = {
  user?: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    callSign?: string | null;
    flights?: {
      nodes?: Array<AccountFlight | null> | null;
      pageInfo?: PageInfo | null;
    } | null;
  } | null;
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

function fullName(user: Pick<AccountUser, "firstName" | "lastName">): string {
  return [user.firstName, user.lastName].map(cleanText).filter(Boolean).join(" ");
}

function graphQlErrorMessage(errors: GraphQlError[] | undefined): string {
  return (
    errors
      ?.map((error) => cleanText(error.message))
      .filter(Boolean)
      .join("; ") || "Erro GraphQL sem mensagem."
  );
}

function isAccountSpecificKeyError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /account-specific API key/i.test(error.message) &&
    /my\|?FlightLogger/i.test(error.message)
  );
}

async function requestGraphQl<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<GraphQlResponse<T>> {
  const response = await fetch(FLIGHTLOGGER_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
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

  return (await response.json()) as GraphQlResponse<T>;
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

function inferredAircraftModel(
  registration: string | null,
  model: unknown,
): string | null {
  if (registration?.startsWith("OE-")) return "PA-28";
  if (registration?.startsWith("CS-")) return "P2008";
  return normalizeAircraftModel(model);
}

function mapLogbookEntry(entry: FlightLoggerLogbookEntry): Flight {
  const offBlock = cleanText(entry.offBlock);
  const onBlock = cleanText(entry.onBlock);
  const registration = cleanRegistration(entry.registration);

  return {
    id: String(entry.id),
    date: offBlock?.slice(0, 10) ?? null,
    departure_airport_name: cleanText(entry.departureAirportName),
    off_block: offBlock,
    arrival_airport_name: cleanText(entry.arrivalAirportName),
    on_block: onBlock,
    type_of_aircraft: inferredAircraftModel(
      registration,
      entry.typeOfAircraft,
    ),
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

function mapAccountFlight(entry: AccountFlight, profile: AccountUser): Flight {
  const offBlock = cleanText(entry.offBlock);
  const onBlock = cleanText(entry.onBlock);
  const registration = cleanRegistration(entry.aircraft?.callSign);
  const aircraftClass = entry.aircraft?.aircraftClass ?? null;
  const flightType = entry.flightType ?? null;
  const flightSeconds = Math.max(0, entry.ftSeconds ?? 0);
  const isSimulator =
    aircraftClass === "SIMULATOR" || flightType === "SIM";

  const landings = (entry.landings ?? []).reduce(
    (total, landing) => {
      if (
        !landing ||
        !["LANDING", "TOUCH_AND_GO"].includes(landing.landingType ?? "")
      ) {
        return total;
      }

      const count = Math.max(0, landing.landingTypeCount ?? 0);
      if (landing.nightLanding) total.night += count;
      else total.day += count;
      return total;
    },
    { day: 0, night: 0 },
  );

  const vfrMinutes = secondsToMinutes(entry.vfrSeconds);
  const ifrMinutes = secondsToMinutes(entry.ifrSeconds);
  const picMinutes =
    flightType === "SOLO" || flightType === "SPIC"
      ? secondsToMinutes(flightSeconds)
      : 0;
  const dualMinutes =
    flightType === "DUAL" ? secondsToMinutes(flightSeconds) : 0;
  const simulatorMinutes = isSimulator
    ? secondsToMinutes(flightSeconds)
    : 0;
  const pilotName =
    flightType === "SOLO" || flightType === "SPIC"
      ? cleanText(fullName(profile))
      : null;

  return {
    id: `account-flight-${String(entry.id)}`,
    date: offBlock?.slice(0, 10) ?? null,
    departure_airport_name: cleanText(entry.departureAirport?.name),
    off_block: offBlock,
    arrival_airport_name: cleanText(entry.arrivalAirport?.name),
    on_block: onBlock,
    type_of_aircraft: inferredAircraftModel(
      registration,
      entry.aircraft?.model,
    ),
    registration,
    name_of_pilot_in_command: pilotName,
    total_minutes: isSimulator ? 0 : secondsToMinutes(flightSeconds),
    day_minutes: isSimulator ? 0 : secondsToMinutes(entry.daySeconds),
    night_minutes: isSimulator ? 0 : secondsToMinutes(entry.nightSeconds),
    single_engine_vfr_minutes:
      aircraftClass === "SINGLE_ENGINE" && !isSimulator ? vfrMinutes : 0,
    single_engine_ifr_minutes:
      aircraftClass === "SINGLE_ENGINE" && !isSimulator ? ifrMinutes : 0,
    multi_engine_vfr_minutes:
      aircraftClass === "MULTI_ENGINE" && !isSimulator ? vfrMinutes : 0,
    multi_engine_ifr_minutes:
      aircraftClass === "MULTI_ENGINE" && !isSimulator ? ifrMinutes : 0,
    pilot_in_command_minutes: picMinutes,
    co_pilot_minutes: 0,
    multi_pilot_minutes: 0,
    flight_instructor_minutes: 0,
    dual_minutes: dualMinutes,
    synthetic_training_minutes: simulatorMinutes,
    instructor_synthetic_training_minutes: 0,
    landings_day: landings.day,
    landings_night: landings.night,
    remarks_and_endorsements: null,
    include_in_ftl: null,
    if_time_minutes: secondsToMinutes(entry.ifSeconds),
  };
}

async function fetchPersonalFlightStats(
  token: string,
): Promise<FlightStatsResponse> {
  const entries: FlightLoggerLogbookEntry[] = [];
  let profile: FlightLoggerProfile | null = null;
  let after: string | null = null;
  let hasMorePages = false;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const payload: GraphQlResponse<PersonalFlightLoggerData> = await requestGraphQl<PersonalFlightLoggerData>(
      token,
      LOGBOOK_QUERY,
      {
        first: PAGE_SIZE,
        after,
      },
    );

    if (payload.errors?.length) {
      throw new Error(graphQlErrorMessage(payload.errors));
    }

    const source: PersonalFlightLoggerData["myFlightLogger"] = payload.data?.myFlightLogger;
    if (!source) {
      throw new Error(
        "O token não devolveu dados de myFlightLogger. Confirma se é um token pessoal com acesso ao logbook.",
      );
    }

    profile ??= {
      firstName: source.firstName,
      lastName: source.lastName,
      callSign: source.callSign,
    };

    const connection: NonNullable<PersonalFlightLoggerData["myFlightLogger"]>["logbookEntries"] = source.logbookEntries;
    for (const node of connection?.nodes ?? []) {
      if (node) entries.push(node);
    }

    hasMorePages = Boolean(connection?.pageInfo?.hasNextPage);
    if (!hasMorePages) break;

    const nextCursor: string | null = connection?.pageInfo?.endCursor ?? null;
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

  return {
    flights: entries
      .map(mapLogbookEntry)
      .sort((a, b) =>
        String(b.off_block ?? "").localeCompare(String(a.off_block ?? "")),
      ),
    profile,
    syncedAt: new Date().toISOString(),
  };
}

async function findAccountUser(token: string): Promise<AccountUser> {
  const configuredEmail = cleanText(process.env.FLIGHTLOGGER_USER_EMAIL);
  const systemEmail = cleanText(process.env.VERCEL_GIT_COMMIT_AUTHOR_EMAIL);
  const systemName = cleanText(process.env.VERCEL_GIT_COMMIT_AUTHOR_NAME);
  const email = configuredEmail ?? systemEmail;

  const search = async (
    searchEmail: string | null,
    searchTerm: string | null,
  ): Promise<AccountUser[]> => {
    const payload = await requestGraphQl<AccountUserData>(
      token,
      ACCOUNT_USER_QUERY,
      {
        email: searchEmail,
        searchTerm,
        first: 100,
      },
    );

    if (payload.errors?.length) {
      throw new Error(graphQlErrorMessage(payload.errors));
    }

    return (payload.data?.users?.nodes ?? []).filter(
      (user): user is AccountUser => Boolean(user),
    );
  };

  if (email) {
    const users = await search(email, null);
    const exact = users.find(
      (user) =>
        cleanText(user.contact?.email)?.toLowerCase() === email.toLowerCase(),
    );
    if (exact) return exact;
  }

  if (systemName) {
    const users = await search(null, systemName);
    const normalizedName = systemName.toLocaleLowerCase("pt-PT");
    const exactMatches = users.filter(
      (user) =>
        fullName(user).toLocaleLowerCase("pt-PT") === normalizedName,
    );
    if (exactMatches.length === 1) return exactMatches[0];
  }

  const error = new Error(
    configuredEmail
      ? "Não foi encontrado um utilizador FlightLogger com o email indicado em FLIGHTLOGGER_USER_EMAIL."
      : "A chave é específica da conta. Adiciona FLIGHTLOGGER_USER_EMAIL na Vercel com o email do teu utilizador FlightLogger e faz redeploy.",
  );
  error.name = "FLIGHTLOGGER_USER_NOT_CONFIGURED";
  throw error;
}

async function fetchAccountFlightStats(
  token: string,
): Promise<FlightStatsResponse> {
  const accountUser = await findAccountUser(token);
  const entries: AccountFlight[] = [];
  let profile: FlightLoggerProfile | null = null;
  let after: string | null = null;
  let hasMorePages = false;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const payload: GraphQlResponse<AccountFlightData> = await requestGraphQl<AccountFlightData>(
      token,
      ACCOUNT_FLIGHTS_QUERY,
      {
        id: accountUser.id,
        first: PAGE_SIZE,
        after,
      },
    );

    if (payload.errors?.length) {
      throw new Error(graphQlErrorMessage(payload.errors));
    }

    const source: AccountFlightData["user"] = payload.data?.user;
    if (!source) {
      throw new Error(
        "A conta FlightLogger não permitiu consultar os voos do utilizador selecionado.",
      );
    }

    profile ??= {
      firstName: cleanText(source.firstName) ?? "",
      lastName: cleanText(source.lastName) ?? "",
      callSign: cleanText(source.callSign) ?? "",
    };

    const connection: NonNullable<AccountFlightData["user"]>["flights"] = source.flights;
    for (const node of connection?.nodes ?? []) {
      if (node) entries.push(node);
    }

    hasMorePages = Boolean(connection?.pageInfo?.hasNextPage);
    if (!hasMorePages) break;

    const nextCursor: string | null = connection?.pageInfo?.endCursor ?? null;
    if (!nextCursor || nextCursor === after) {
      throw new Error("A paginação dos voos FlightLogger não avançou.");
    }
    after = nextCursor;
  }

  if (hasMorePages) {
    throw new Error(
      `Os voos excederam o limite de ${MAX_PAGES * PAGE_SIZE} registos por sincronização.`,
    );
  }

  if (!profile) {
    throw new Error("Não foi possível obter o perfil FlightLogger.");
  }

  return {
    flights: entries
      .map((entry) => mapAccountFlight(entry, accountUser))
      .sort((a, b) =>
        String(b.off_block ?? "").localeCompare(String(a.off_block ?? "")),
      ),
    profile,
    syncedAt: new Date().toISOString(),
  };
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

  try {
    return await fetchPersonalFlightStats(token);
  } catch (error) {
    if (isAccountSpecificKeyError(error)) {
      return fetchAccountFlightStats(token);
    }
    throw error;
  }
}
