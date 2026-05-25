import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);
export const db = getFirestore(app);

export type Flight = {
  id?: string;

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

  raw?: Record<string, unknown>;
  created_at?: unknown;
};

export type FlightInsert = Omit<Flight, "id">;
