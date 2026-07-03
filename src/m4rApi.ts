/**
 * Client HTTP de l'API de motion4rent (endpoints PÚBLICS, read-only):
 *   - GET /ai/cities/:city                    → geocodificació + desambiguació
 *   - GET /search/results/...                 → productes concrets amb preus
 *   - GET /details/...                        → detall d'un producte
 *
 * Cap escriptura, cap creació de comanda. La resposta de l'API sol venir
 * embolcallada com { statusCode, body: {...} }; unwrapBody() ho normalitza.
 */

import { slugCiudad } from "./deeplink.js";

const SEARCH_TIMEOUT_MS = 25_000;
const DEFAULT_TIMEOUT_MS = 8_000;

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} en ${url}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** L'API embolcalla la resposta en { statusCode, body }. Retorna el body (o l'objecte tal qual). */
function unwrapBody(raw: unknown): any {
  if (raw && typeof raw === "object" && "body" in (raw as any)) {
    return (raw as any).body;
  }
  return raw;
}

/** Normalitza un idioma a un locale que accepta l'API (/search). */
export function apiLocale(language: string): string {
  const l = (language ?? "en").trim().toLowerCase().slice(0, 2);
  return ["en", "es", "fr", "de", "it", "nl", "pt"].includes(l) ? l : "en";
}

export interface GeoPlace {
  country: string;
  cityEn: string | null;
  cityEs: string | null;
  url: string; // slug de ciutat (url_en)
  lat: string;
  lon: string;
  source: string;
}

export interface GeocodeResult {
  count: number;
  countries: number; // > 1 → homònimes, cal desambiguar
  places: GeoPlace[];
}

export async function geocodeCity(apiBase: string, city: string): Promise<GeocodeResult> {
  const slug = slugCiudad(city);
  const raw = await getJson(`${apiBase}/ai/cities/${encodeURIComponent(slug)}`, DEFAULT_TIMEOUT_MS);
  const body = unwrapBody(raw);
  const places: GeoPlace[] = Array.isArray(body?.places)
    ? body.places.map((p: any) => ({
        country: String(p.country ?? "").toLowerCase(),
        cityEn: p.city_en ?? null,
        cityEs: p.city_es ?? null,
        url: p.url ?? slug,
        lat: String(p.lat ?? ""),
        lon: String(p.lon ?? ""),
        source: p.source ?? "",
      }))
    : [];
  return {
    count: Number(body?.count ?? places.length),
    countries: Number(body?.countries ?? new Set(places.map((p) => p.country)).size),
    places,
  };
}

export interface Producto {
  id_product_store: number | null;
  id_store: number | null;
  id_virtual: number | null;
  name: string;
  total: number | null; // preu total per al rang de dates
  currency: string | null;
  image: string | null;
  cancellation_name: string | null;
  cancellation_days: number | null;
  cancellation_refundable: number | null;
}

export interface TipoProducto {
  id: number;
  name: string;
}

export interface SearchResult {
  number: number; // nº de resultats (>0 = hi ha disponibilitat)
  productos: Producto[];
  typesProducts: TipoProducto[];
}

export interface SearchArgs {
  country: string;
  citySlug: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  sh?: string; // HHMM
  eh?: string; // HHMM
  locale: string;
  type?: number; // 0 = tots
  lat?: string;
  lon?: string;
}

export async function searchResults(apiBase: string, a: SearchArgs): Promise<SearchResult> {
  const sh = a.sh && /^\d{3,4}$/.test(a.sh) ? a.sh : "1000";
  const eh = a.eh && /^\d{3,4}$/.test(a.eh) ? a.eh : "1000";
  const type = Number.isFinite(a.type as number) ? (a.type as number) : 0;
  const lat = a.lat && a.lat.trim() ? a.lat : "0";
  const lon = a.lon && a.lon.trim() ? a.lon : "0";
  const country = (a.country && a.country.trim()) ? a.country : "xx";

  const url =
    `${apiBase}/search/results/${encodeURIComponent(country)}/${encodeURIComponent(a.citySlug)}` +
    `/${a.start}/${sh}/${a.end}/${eh}/${encodeURIComponent(a.locale)}/${type}/${lat}/${lon}?attributes=full`;

  const body = unwrapBody(await getJson(url, SEARCH_TIMEOUT_MS));
  const resp: any[] = Array.isArray(body?.response) ? body.response : [];
  const productos: Producto[] = resp.map((it: any) => ({
    id_product_store: it.id_product_store ?? null,
    id_store: it.id_store ?? null,
    id_virtual: it.id_virtual ?? null,
    name: it.name ?? "Mobility equipment",
    total: it.total != null ? Number(it.total) : (it.price != null ? Number(it.price) : null),
    currency: it.currency ?? null,
    image: it.image ?? null,
    cancellation_name: it.cancellation_name ?? null,
    cancellation_days: it.cancellation_days != null ? Number(it.cancellation_days) : null,
    cancellation_refundable: it.cancellation_refundable != null ? Number(it.cancellation_refundable) : null,
  }));
  const typesProducts: TipoProducto[] = Array.isArray(body?.typesProducts)
    ? body.typesProducts
        .filter((t: any) => t && t.name != null)
        .map((t: any) => ({ id: Number(t.id ?? 0), name: String(t.name) }))
    : [];
  return { number: Number(body?.number ?? productos.length), productos, typesProducts };
}

export interface DetailsArgs {
  idProductStore: number;
  idStore: number;
  idVirtual: number;
  start: string;
  end: string;
  sh?: string;
  eh?: string;
  locale: string;
  lat?: string;
  lon?: string;
}

export interface DetallProducto {
  name: string | null; // nom del PRODUCTE (data[0].details.name), no de la botiga
  type: string | null;
  price_total: number | null; // totalWithOutExtra (preu base del rang)
  currency: string | null;
  days: number | null;
  prepayment_percent: number | null;
  discount_percent: number | null;
  deposit: number | null; // fiança reembolsable (data[0].bail); null si no n'hi ha
  cancellation: {
    name: string | null;
    days: number | null;
    refundable: number | null;
    percent: number | null;
  };
  image: string | null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalitza la resposta CRUA de /details.
 * Forma real (verificat contra prod): body.data[0] és la BOTIGA + tarifa (preu,
 * cancel·lació, bail…), i body.data[0].details és el PRODUCTE (name, type_product…).
 * Les specs (pes/autonomia) NO venen a /details (viuen a /products/load) → no s'hi inclouen;
 * per a specs generals hi ha la tool mobility_policies (peso_capacidad).
 */
export function normalizeDetails(raw: any): DetallProducto | null {
  const body = raw;
  const d = Array.isArray(body?.data) ? body.data[0] : (body?.data ?? body);
  if (!d || typeof d !== "object") return null;
  const p = d.details ?? {}; // el producte

  return {
    name: p.name ?? p.title ?? p.type_product ?? d.name ?? null,
    type: p.type_product ?? d.type_product ?? null,
    price_total: num(d.totalWithOutExtra ?? d.total ?? d.price),
    currency: d.currency ?? null,
    days: num(body?.days ?? d.days),
    prepayment_percent: num(d.prepayment),
    discount_percent: num(d.percent_discount),
    deposit: num(d.bail),
    cancellation: {
      name: d.cancellation_name ?? null,
      days: num(d.cancellation_days),
      refundable: num(d.cancellation_refundable),
      percent: num(d.cancellation_percent),
    },
    image: d.image ?? p.icon ?? null,
  };
}

export async function getDetails(apiBase: string, a: DetailsArgs): Promise<DetallProducto | null> {
  const sh = a.sh && /^\d{3,4}$/.test(a.sh) ? a.sh : "1000";
  const eh = a.eh && /^\d{3,4}$/.test(a.eh) ? a.eh : "1000";
  const q = new URLSearchParams();
  if (a.lat) q.set("lat", a.lat);
  if (a.lon) q.set("lon", a.lon);
  const url =
    `${apiBase}/details/${a.idProductStore}/${a.idStore}/${a.idVirtual}` +
    `/${a.start}/${a.end}/${sh}/${eh}/${encodeURIComponent(a.locale)}` +
    (q.toString() ? `?${q.toString()}` : "");
  return normalizeDetails(unwrapBody(await getJson(url, SEARCH_TIMEOUT_MS)));
}
