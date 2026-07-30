export type Flight = {
  id: string;
  date: string | null;
  departure_airport_name: string | null;
  off_block: string | null;
  arrival_airport_name: string | null;
  on_block: string | null;
  type_of_aircraft: string | null;
  registration: string | null;
  name_of_pilot_in_command: string | null;
  total_minutes: number;
  day_minutes: number;
  night_minutes: number;
  single_engine_vfr_minutes: number;
  single_engine_ifr_minutes: number;
  multi_engine_vfr_minutes: number;
  multi_engine_ifr_minutes: number;
  pilot_in_command_minutes: number;
  co_pilot_minutes: number;
  multi_pilot_minutes: number;
  flight_instructor_minutes: number;
  dual_minutes: number;
  synthetic_training_minutes: number;
  instructor_synthetic_training_minutes: number;
  landings_day: number;
  landings_night: number;
  remarks_and_endorsements: string | null;
  include_in_ftl: boolean | null;
  if_time_minutes: number;
};

export type FlightLoggerProfile = {
  firstName: string;
  lastName: string;
  callSign: string;
};

export type FlightStatsResponse = {
  flights: Flight[];
  profile: FlightLoggerProfile;
  syncedAt: string;
};

export type FlightStatsErrorResponse = {
  error: string;
  code?: string;
};
