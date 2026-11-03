import { type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

type Coord = AnyPgColumn | number | SQL;

/** Great-circle distance in km between two points (haversine), computed in Postgres. */
export function distanceKmSql(lat1: Coord, lng1: Coord, lat2: Coord, lng2: Coord): SQL<number> {
  return sql<number>`(6371 * 2 * asin(sqrt(
    power(sin(radians(${lat2} - ${lat1}) / 2), 2) +
    cos(radians(${lat1})) * cos(radians(${lat2})) *
    power(sin(radians(${lng2} - ${lng1}) / 2), 2)
  )))`;
}

/** Rounded up to the next half kilometre, so a customer's exact spot can't be worked out. */
export function roughKm(km: number): number {
  return Math.max(0.5, Math.ceil(Number(km) * 2) / 2);
}
