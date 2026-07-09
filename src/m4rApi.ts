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

// Cache en memòria amb TTL per a dades ESTÀTIQUES de catàleg (model/specs, extres, geocoding, monedes).
// ⚠️ NO s'hi cacheja /details ni els tipus de canvi: preu/disponibilitat depenen de dates → sempre fresc.
// Guarda la Promise → dedupe de crides concurrents idèntiques; si falla, s'esborra i es reintenta.
const _cache = new Map<string, { at: number; p: Promise<any> }>();
export const CATALOG_TTL_MS = 10 * 60_000; // 10 min: catàleg (model/specs/extres) canvia rarament
function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = _cache.get(key);
  if (hit && now - hit.at < ttlMs) return hit.p as Promise<T>;
  const p = fn().catch((e) => {
    _cache.delete(key);
    throw e;
  });
  _cache.set(key, { at: now, p });
  return p;
}
// Neteja periòdica perquè el Map no creixi sense límit.
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of _cache) if (now - e.at > 30 * 60_000) _cache.delete(k);
}, 5 * 60_000).unref();

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
  // Coordenades de ciutat = estàtiques → cachejat (TTL llarg).
  return memo(`geo:${apiBase}:${slug}`, 30 * 60_000, async () => {
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
  });
}

export interface Producto {
  id_product_store: number | null;
  id_store: number | null;
  id_virtual: number | null;
  name: string;
  total: number | null; // preu BASE del rang (sense el fee de gestió; la cerca no l'inclou)
  currency: string | null;
  image: string | null;
  store_extra_fee: number | null; // part variable del fee de gestió (store.extra_fee); base + això = feeGestionM4R
  pickup_closed_service: boolean; // recollida/tornada en dia festiu → recàrrec closed_price
  delivery_closed_service: boolean; // lliurament en dia festiu → recàrrec closed_price
  cancellation_name: string | null;
  cancellation_days: number | null;
  cancellation_refundable: number | null;
  // Paràmetres per a products/load (model + specs reals): id_product_store va com a :id_product.
  type_att: number | null;
  same_city: number | null;
  id_virtual_real: number | null;
  radius: number | null;
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
    store_extra_fee: it.extra_fee != null ? Number(it.extra_fee) : null,
    pickup_closed_service: Number(it.pickup_closed_service ?? 0) === 1,
    delivery_closed_service: Number(it.delivery_closed_service ?? 0) === 1,
    cancellation_name: it.cancellation_name ?? null,
    cancellation_days: it.cancellation_days != null ? Number(it.cancellation_days) : null,
    cancellation_refundable: it.cancellation_refundable != null ? Number(it.cancellation_refundable) : null,
    type_att: it.type_att_product != null ? Number(it.type_att_product) : null,
    same_city: it.same_city != null ? Number(it.same_city) : null,
    id_virtual_real: it.virtualStoreReal != null ? Number(it.virtualStoreReal) : null,
    radius: it.radius != null ? Number(it.radius) : null,
  }));
  const typesProducts: TipoProducto[] = Array.isArray(body?.typesProducts)
    ? body.typesProducts
        .filter((t: any) => t && t.name != null)
        .map((t: any) => ({ id: Number(t.id ?? 0), name: String(t.name) }))
    : [];
  return { number: Number(body?.number ?? productos.length), productos, typesProducts };
}

// ---------------------------------------------------------------------------
// Moneda (dinàmica): la font de veritat és la taula exchange_rates de l'API.
// getActiveCurrencies → llista de monedes disponibles (si demà se n'afegeix una
// a exchange_rates, apareix aquí sense tocar codi). getExchangeRate → mateix
// 'rate' que fa servir el web a exchange() (coherent amb el que cobra el booking).
// ---------------------------------------------------------------------------

/** Monedes actives de la plataforma (de /exchange/rates-to-eur). EUR sempre primer. */
export async function getActiveCurrencies(apiBase: string): Promise<string[]> {
  // Llista de monedes = gairebé estàtica → cachejat (TTL llarg). NO cachegem els rates (getExchangeRate).
  return memo(`cur:${apiBase}`, 30 * 60_000, async () => {
    const body = unwrapBody(await getJson(`${apiBase}/exchange/rates-to-eur`, DEFAULT_TIMEOUT_MS));
    const map = body && typeof body === "object" && body.data && typeof body.data === "object" ? body.data : {};
    const codes = Object.keys(map).map((c) => c.toUpperCase());
    return ["EUR", ...codes.filter((c) => c !== "EUR").sort()];
  });
}

/** Rate de conversió from→to (mateix 'rate' que el web a exchange()). 1 si from==to o error. */
export async function getExchangeRate(apiBase: string, from: string, to: string): Promise<number> {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return 1;
  try {
    const body = unwrapBody(
      await getJson(`${apiBase}/exchange/${encodeURIComponent(f)}/${encodeURIComponent(t)}/1`, DEFAULT_TIMEOUT_MS),
    );
    const rate = Number(body);
    return Number.isFinite(rate) && rate > 0 ? rate : 1;
  } catch {
    return 1;
  }
}

// ---------------------------------------------------------------------------
// Opcions/extres d'un producte (descoberta). Endpoint existent i lleuger:
// GET /details/options/{id_product_store} → totes les opcions actives del producte.
// El preu ve en la moneda del producte; type 1 = fix, altrament = per dia.
// La reserva (create_booking) recalcula i valora al servidor; aquí és només informatiu.
// ---------------------------------------------------------------------------
export interface ProductOption {
  id: number; // product_options.id → això és el que va a create_booking com options_id
  name: string;
  price: number;
  type: number; // 1 = preu fix; altrament = preu × dies
}

export async function getProductOptions(apiBase: string, idProductStore: number): Promise<ProductOption[]> {
  const url = `${apiBase}/details/options/${idProductStore}`;
  // Extres = catàleg estàtic → cachejat.
  return memo(`opts:${url}`, CATALOG_TTL_MS, async () => {
    const body = unwrapBody(await getJson(url, DEFAULT_TIMEOUT_MS));
    const rows: any[] = Array.isArray(body?.response) ? body.response : [];
    return rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name ?? "Opció"),
      price: Number(r.price ?? 0),
      type: Number(r.type ?? 0),
    }));
  });
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
  /** Recàrrec servei en dia festiu (de la cerca): recollida/tornada en dia tancat. Sense això /details el posa a 0. */
  pickupClosedService?: boolean;
  deliveryClosedService?: boolean;
}

export interface DetallProducto {
  name: string | null; // nom del PRODUCTE (data[0].details.name), no de la botiga
  type: string | null;
  brand: string | null; // marca (per distingir models; el nom sol ser genèric per tipus)
  model: string | null; // model
  price_total: number | null; // totalWithOutExtra (preu base del rang)
  price_per_day: number | null; // preu final / dies (per mostrar "X/dia" com el web)
  currency: string | null;
  days: number | null;
  rating: number | null; // valoració mitjana (score, 0-5); null si no en té
  reviews: number | null; // nombre de ressenyes; null si 0
  attributes: Array<{ label: string; value: string }>; // specs clau (pes màx, plegable, dimensions…)
  prepayment_percent: number | null;
  discount_percent: number | null;
  deposit: number | null; // fiança reembolsable (data[0].bail); null si no n'hi ha
  city_delivery_price: number | null; // preu pla de lliurament a ciutat (details.delivery_price); 0/null = pickup gratis
  delivery_available: boolean; // details.delivery>0 → admet domicili/hotel
  cruise_available: boolean; // details.cruises>0 → admet lliurament a creuer
  pickup_available: boolean; // store.pickup>0 → hi ha recollida a botiga (les virtuals NO en tenen)
  is_virtual: boolean; // botiga virtual (id_virtual>0): el lliurament és gratis (com payAction)
  airports: Array<{ place_id: string; name: string; price: number | null }>; // lliurament a aeroport (buit si no n'hi ha)
  store_name: string | null; // nom de la botiga (per presentar; MAI l'id intern)
  store_place_id: string | null; // per construir l'enllaç de mapa
  type_att: number | null; // type_att_product → per a products/load (model + specs reals)
  same_city: number | null;
  id_virtual_real: number | null;
  image: string | null; // filename (usar productImageUrl per a la URL pública)
  cancellation: {
    name: string | null;
    days: number | null;
    refundable: number | null;
    percent: number | null;
  };
}

/**
 * URL pública (CDN) d'una imatge de producte a partir del filename de /details. null si buit.
 * `width` opcional: si el base acaba en /wNNN, el substitueix (p. ex. 480 per a miniatures de llistat).
 */
export function productImageUrl(
  base: string,
  filename: string | null | undefined,
  width?: number,
): string | null {
  const f = (filename ?? "").trim();
  if (f === "") return null;
  const clean = f.replace(/^\/+/, "");
  let b = base;
  if (width && /\/w\d+$/.test(b)) {
    b = b.replace(/\/w\d+$/, `/w${width}`);
  }
  return `${b}/${clean}`;
}

/**
 * Enllaç de Google Maps de la botiga. Si hi ha place_id, s'usa una query NEUTRA (Google centra pel
 * place_id igualment) per NO filtrar el nom del partner ni dins la URL. Sense place_id, cau a cerca per nom.
 */
export function storeMapUrl(placeId: string | null | undefined, name: string | null | undefined): string | null {
  const pid = (placeId ?? "").trim();
  if (pid !== "") {
    return `https://www.google.com/maps/search/?api=1&query=location&query_place_id=${encodeURIComponent(pid)}`;
  }
  const n = (name ?? "").trim();
  return n !== "" ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(n)}` : null;
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
/** Recull tots els atributs (code/label/value) de details._children[].attributes, deduplicats per code. */
function collectAttributes(p: any): Array<{ code: string; label: string; value: string }> {
  const out: Array<{ code: string; label: string; value: string }> = [];
  const seen = new Set<string>();
  const children = Array.isArray(p?._children) ? p._children : [];
  for (const child of children) {
    const groups = Array.isArray(child?.attributes) ? child.attributes : [];
    for (const grp of groups) {
      const attrs = Array.isArray(grp) ? grp : [grp];
      for (const a of attrs) {
        const code = String(a?.code ?? "").trim();
        const label = String(a?.label ?? "").trim();
        const raw = a?.value;
        const value = raw === null || raw === undefined ? "" : String(raw).trim();
        const key = code || label;
        if (!value || !key || seen.has(key)) continue;
        seen.add(key);
        out.push({ code, label, value });
      }
    }
  }
  return out;
}

/** Codes d'atribut que són el nom del model, no una spec (no s'han de repetir com a badge). */
const MODEL_ATTR_CODES = new Set(["brand", "model", "name"]);

export function normalizeDetails(raw: any): DetallProducto | null {
  const body = raw;
  const d = Array.isArray(body?.data) ? body.data[0] : (body?.data ?? body);
  if (!d || typeof d !== "object") return null;
  const p = d.details ?? {}; // el producte

  const priceTotal = num(d.total ?? d.totalWithOutExtra ?? d.price);
  const days = num(body?.days ?? d.days);
  const rating = num(d.score ?? p.score);
  const reviews = num(d.review ?? p.review);

  // brand/model vénen com ATRIBUTS (code 'brand'/'model'), igual que getData() al web; el camp
  // top-level p.brand/p.model sol ser buit. Fallback al top-level per si de cas.
  const allAttrs = collectAttributes(p);
  const attrByCode = (c: string) => allAttrs.find((a) => a.code === c)?.value || null;
  const brand = attrByCode("brand") ?? (p.brand || null);
  const model = attrByCode("model") ?? (p.model || null);
  // Specs a mostrar com a badges: tot menys els codes que ja formen el nom del model.
  const specAttributes = allAttrs
    .filter((a) => !MODEL_ATTR_CODES.has(a.code))
    .slice(0, 10)
    .map(({ label, value }) => ({ label, value }));

  return {
    name: p.name ?? p.title ?? p.type_product ?? d.name ?? null,
    type: p.type_product ?? d.type_product ?? null,
    brand,
    model,
    // PREU AMB FEES (d.total = base + feeGestionM4R + extraM4R + extraSup) — el que cobra la reserva i el web.
    // NO usar totalWithOutExtra (base): infravaloraria ~9€+. d.total ≥ booking (el descompte només abaixa).
    price_total: priceTotal,
    price_per_day: priceTotal != null && days && days > 0 ? Math.round((priceTotal / days) * 100) / 100 : priceTotal,
    rating: rating && rating > 0 ? rating : null,
    reviews: reviews && reviews > 0 ? reviews : null,
    attributes: specAttributes,
    currency: d.currency ?? null,
    days,
    prepayment_percent: num(d.prepayment),
    discount_percent: num(d.percent_discount),
    deposit: num(d.bail),
    city_delivery_price: num(p.delivery_price),
    delivery_available: (num(p.delivery) ?? 0) > 0,
    cruise_available: (num(p.cruises) ?? 0) > 0,
    pickup_available: (num(body?.store?.pickup ?? d.pickup) ?? 0) > 0,
    is_virtual: (num(d.id_virtual) ?? 0) > 0,
    store_name: (body?.store?.name ?? null) || null,
    store_place_id: (body?.store?.place_id ?? null) || null,
    type_att: num(d.type_att_product),
    same_city: num(d.same_city),
    id_virtual_real: num(d.id_virtual_real),
    airports:
      num(p.airport_delivery) && Array.isArray(p.airports_list)
        ? p.airports_list.map((a: any) => ({
            place_id: String(a?.place_id ?? ""),
            name: String(a?.name?.en ?? a?.name?.es ?? "Airport"),
            price: num(a?.price),
          }))
        : [],
    cancellation: {
      name: d.cancellation_name ?? null,
      days: num(d.cancellation_days),
      refundable: num(d.cancellation_refundable),
      percent: num(d.cancellation_percent),
    },
    image: d.image ?? p.icon ?? null,
  };
}

// ---------------------------------------------------------------------------
// Booking headless (Fase 3A): POST {checkoutBaseUrl}/ai/checkout al WEB PHP.
// El web recalcula el preu via /details i crea el hold + la Stripe session.
// Aquí NO s'envia cap import: el caller només passa ids + dates + PII.
// ---------------------------------------------------------------------------
const BOOKING_TIMEOUT_MS = 30_000; // /details (pesat) + /order + Stripe, possiblement cross-regió

export interface BookingCustomer {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  prefix?: string;
  country: string;
}

export interface CreateBookingArgs {
  idProductStore: number; // primer segment de /details (search retorna id_product_store)
  idStore: number;
  idVirtual: number;
  start: string;
  end: string;
  sh?: string;
  eh?: string;
  locale: string;
  customer: BookingCustomer;
  newsletter?: boolean;
  comments?: string;
  /** Moneda demanada per l'usuari (una d'actives). Buit = moneda del producte. El web valida + converteix. */
  currency?: string;
  /** IDs d'opcions/extres a afegir (de /details/options). El web en valora el preu server-side. */
  optionsId?: number[];
  /** Tipus de lliurament: 0/undefined recollida a botiga, 1 domicili, 2 hotel (ciutat), 5 aeroport. */
  deliveryType?: number;
  /** Adreça de lliurament (obligatòria si deliveryType 1/2). */
  deliveryAddress?: string;
  /** Nom de l'hotel (opcional, si deliveryType 2). */
  hotelName?: string;
  /** place_id de l'aeroport (de get_rental_details.airports; obligatori si deliveryType 5). */
  airportPlaceId?: string;
  /** Nº de vol (obligatori si deliveryType 5). */
  flightNumber?: string;
  /** Recàrrec dia festiu (de la cerca): recollida/tornada / lliurament en dia tancat. */
  pickupClosedService?: boolean;
  deliveryClosedService?: boolean;
}

export interface BookingResult {
  ok: boolean;
  /** El supplier requereix el checkout complet (diferit/split) → cal fallback al deep-link. */
  fallbackDeeplink?: boolean;
  status: number;
  increment_id?: string;
  urlTpv?: string;
  total?: number;
  pay_now?: number;
  pay_at_pickup?: number;
  prepayment_pct?: number;
  free_cancellation_until?: string | null;
  error?: string;
}

export async function createBooking(
  checkoutBaseUrl: string,
  secret: string,
  a: CreateBookingArgs,
): Promise<BookingResult> {
  const body = {
    id_product: a.idProductStore,
    id_store: a.idStore,
    id_virtual: a.idVirtual,
    start: a.start,
    end: a.end,
    sh: a.sh && /^\d{3,4}$/.test(a.sh) ? a.sh : "1000",
    eh: a.eh && /^\d{3,4}$/.test(a.eh) ? a.eh : "1000",
    locale: a.locale,
    customer: {
      firstName: a.customer.firstName,
      lastName: a.customer.lastName,
      email: a.customer.email,
      phone: a.customer.phone,
      prefix: a.customer.prefix ?? "",
      country: a.customer.country,
    },
    newsletter: a.newsletter ? 1 : 0,
    comments: a.comments ?? "",
    currency: (a.currency ?? "").toUpperCase(),
    options_id: Array.isArray(a.optionsId) ? a.optionsId : [],
    delivery: a.deliveryType ?? 0,
    delivery_address: a.deliveryAddress ?? "",
    hotel_name: a.hotelName ?? "",
    airport_place_id: a.airportPlaceId ?? "",
    flight_number: a.flightNumber ?? "",
    pickup_closed_service: a.pickupClosedService ? 1 : 0,
    delivery_closed_service: a.deliveryClosedService ? 1 : 0,
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), BOOKING_TIMEOUT_MS);
  try {
    const res = await fetch(`${checkoutBaseUrl}/ai/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json: any = await res.json().catch(() => ({}));
    if (res.status === 409 && json?.status === "fallback_deeplink") {
      return { ok: false, fallbackDeeplink: true, status: 409, error: json?.error };
    }
    if (!res.ok || !json?.urlTpv) {
      return { ok: false, status: res.status, error: json?.error ?? `HTTP ${res.status}` };
    }
    return {
      ok: true,
      status: res.status,
      increment_id: json.increment_id,
      urlTpv: json.urlTpv,
      total: json.total,
      pay_now: json.pay_now,
      pay_at_pickup: json.pay_at_pickup,
      prepayment_pct: json.prepayment_pct,
      free_cancellation_until: json.free_cancellation_until ?? null,
    };
  } finally {
    clearTimeout(t);
  }
}

export async function getDetails(apiBase: string, a: DetailsArgs): Promise<DetallProducto | null> {
  const sh = a.sh && /^\d{3,4}$/.test(a.sh) ? a.sh : "1000";
  const eh = a.eh && /^\d{3,4}$/.test(a.eh) ? a.eh : "1000";
  const q = new URLSearchParams();
  if (a.lat) q.set("lat", a.lat);
  if (a.lon) q.set("lon", a.lon);
  // Recàrrec de dia festiu: passem els flags de la cerca perquè /details inclogui el closed_price.
  if (a.pickupClosedService) q.set("pickup_closed_service", "1");
  if (a.deliveryClosedService) q.set("delivery_closed_service", "1");
  const url =
    `${apiBase}/details/${a.idProductStore}/${a.idStore}/${a.idVirtual}` +
    `/${a.start}/${a.end}/${sh}/${eh}/${encodeURIComponent(a.locale)}` +
    (q.toString() ? `?${q.toString()}` : "");
  return normalizeDetails(unwrapBody(await getJson(url, SEARCH_TIMEOUT_MS)));
}

// ---------------------------------------------------------------------------
// products/load: el MODEL (brand/model) i les specs REALS (pes màx, autonomia,
// plegable, tipus, material…) viuen aquí, NO a /details (que torna les dimensions
// del fill). És l'endpoint que fa servir el web (loadProductAction → getData).
// El path :id_product és en realitat stores_products.id (= id_product_store).
// ---------------------------------------------------------------------------
export interface ProductLoad {
  brand: string | null;
  model: string | null;
  title: string | null; // brand + model + material + featured (el títol que mostra el web)
  subtype: string | null; // valor de l'atribut "type" (p. ex. "Standard", "Portable", "Postural")
  image: string | null; // filename de la imatge real del producte
  attributes: Array<{ label: string; value: string }>;
}

/** Codes d'atribut que NO són specs a mostrar (imatges, dipòsit i el propi nom/model). */
const LOAD_ATTR_HIDE = new Set(["image", "image2", "image3", "bail", "brand", "model", "name"]);

export interface ProductLoadArgs {
  idProductStore: number | string;
  idVirtual: number | string;
  typeAtt: number | string;
  radius?: number | string;
  sameCity?: number | string;
  idVirtualReal?: number | string;
}

export async function getProductLoad(apiBase: string, a: ProductLoadArgs): Promise<ProductLoad | null> {
  const radius = a.radius ?? 0;
  const sameCity = a.sameCity ?? 1;
  const idVirtualReal = a.idVirtualReal ?? 0;
  const url = `${apiBase}/products/load/${a.idProductStore}/${a.idVirtual}/${radius}/${a.typeAtt}/${sameCity}/${idVirtualReal}`;
  // Catàleg estàtic → cachejat (clau = URL, que ja inclou tots els params).
  return memo(`load:${url}`, CATALOG_TTL_MS, async () => {
  const body = unwrapBody(await getJson(url, SEARCH_TIMEOUT_MS));
  const row = Array.isArray(body?.data) ? body.data[0] : null;
  if (!row || typeof row !== "object") return null;

  const map = new Map<string, { label: string; value: string }>();
  for (const grp of Array.isArray(row.attributes) ? row.attributes : []) {
    const attrs = Array.isArray(grp) ? grp : [grp];
    for (const at of attrs) {
      const code = String(at?.code ?? "").trim();
      const label = String(at?.label ?? "").trim();
      let raw: any = at?.value;
      if (Array.isArray(raw)) raw = raw.join(", ");
      if (at?.type === "yesno") raw = String(raw) === "1" ? "Yes" : String(raw) === "0" ? "No" : raw;
      const value = raw === null || raw === undefined ? "" : String(raw).trim();
      if (!code || !value || map.has(code)) continue;
      map.set(code, { label: label || code, value });
    }
  }
  const brand = map.get("brand")?.value || null;
  const model = map.get("model")?.value || null;
  // Nom complet com el web: brand + model + material (si != "No information") + featured.
  // (load-product.phtml: print brand." ".model.$materialFeatured)
  const material = map.get("material")?.value || "";
  const materialPart = material && material !== "No information" ? material : "";
  const featuredPart = (map.get("featured")?.value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
  const title = [brand, model, materialPart, featuredPart].filter(Boolean).join(" ").trim() || null;
  const subtype = map.get("type")?.value || null; // p. ex. "Standard" → categoria "Electric wheelchair · Standard"
  const image = map.get("image")?.value || row.image || null;
  // material i featured ja van dins el nom → no els repetim com a badge (com el web).
  const attributes = [...map.entries()]
    .filter(([code]) => !LOAD_ATTR_HIDE.has(code) && code !== "material" && code !== "featured")
    .slice(0, 12)
    .map(([, v]) => v);
  return { brand, model, title, subtype, image, attributes };
  });
}
