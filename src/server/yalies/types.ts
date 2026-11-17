import { z } from "zod";

const str = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v === null || v === undefined || v === "" ? null : String(v)));

/**
 * The only Yalies fields NEPO reads (section 6.2). zod objects strip unknown
 * keys, so phone, birthday, addresses and anything else the API returns are
 * dropped here, at the client boundary, and never reach the database.
 */
export const yaliesPersonSchema = z.object({
  netid: z.string().min(1).transform((v) => v.toLowerCase()),
  upi: str,
  first_name: str,
  preferred_name: str,
  last_name: str,
  email: str,
  school_code: str,
  school: str,
  college: str,
  year: z
    .union([z.number(), z.string()])
    .nullish()
    .transform((v) => {
      const n = typeof v === "string" ? Number(v) : v;
      return typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : null;
    }),
  major: str,
  image: str,
});

export type YaliesPerson = z.infer<typeof yaliesPersonSchema>;

export type YaliesQuery = {
  query?: string;
  filters?: Record<string, (string | number)[]>;
  page?: number;
  page_size?: number;
};
