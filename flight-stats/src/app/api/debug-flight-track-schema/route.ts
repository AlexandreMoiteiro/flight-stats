import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ENDPOINT = "https://api.flightlogger.net/graphql";

const QUERY = `
  query FlightTrackIntrospection {
    flightType: __type(name: "Flight") {
      fields {
        name
        type {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
            }
          }
        }
      }
    }
    flightTrackType: __type(name: "FlightTrack") {
      fields {
        name
        type {
          kind
          name
          ofType {
            kind
            name
          }
        }
      }
    }
    schema: __schema {
      queryType {
        fields {
          name
        }
      }
    }
  }
`;

export async function GET() {
  const token = process.env.FLIGHTLOGGER_API_TOKEN?.trim();
  if (!token) {
    return NextResponse.json({ error: "missing token" }, { status: 503 });
  }

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query: QUERY }),
    cache: "no-store",
  });

  const payload = await response.json();
  const flightFields = payload?.data?.flightType?.fields ?? [];
  const flightTrackFields = payload?.data?.flightTrackType?.fields ?? [];
  const queryFields = payload?.data?.schema?.queryType?.fields ?? [];

  return NextResponse.json({
    flightFields: flightFields.filter((field: { name: string }) =>
      /track|kml|view|url|flight/i.test(field.name),
    ),
    flightTrackFields,
    queryFields: queryFields
      .map((field: { name: string }) => field.name)
      .filter((name: string) => /track|flight/i.test(name)),
    errors: payload?.errors ?? null,
  });
}
