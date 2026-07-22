/**
 * Tools MCP de Motion4Rent (read-only). El "cervell" conversacional és el client
 * (Claude/ChatGPT); aquestes tools són fines i criden l'API pública + construeixen
 * el deep-link a la web. NO creen comandes ni cobren (opció E del pla).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "./config.js";
import { buildResultsLink, slugCiudad } from "./deeplink.js";
import {
  apiLocale,
  geocodeCity,
  nearbyCitiesWithCoverage,
  listCoverageCities,
  searchResults,
  getDetails,
  getProductLoad,
  createBooking,
  getActiveCurrencies,
  getExchangeRate,
  getProductOptions,
  productImageUrl,
  storeMapUrl,
} from "./m4rApi.js";
import { findPolicies } from "./knowledge/policies.js";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data en format YYYY-MM-DD");
const MAX_PRODUCTS = 25;

/** Normalitza una hora ("10:00", "1000", "10", "9:30") a HHMM de 4 dígits. undefined si no és vàlida. */
function toApiTime(t?: string): string | undefined {
  if (!t) return undefined;
  const s = t.trim();
  let m = s.match(/^(\d{1,2}):?(\d{2})$/);
  if (m) return `${m[1].padStart(2, "0")}${m[2]}`;
  m = s.match(/^(\d{1,2})$/);
  if (m) return `${m[1].padStart(2, "0")}00`;
  return undefined;
}

/** Normalitza text per comparar (minúscules, sense accents ni símbols, espais col·lapsats). */
function normText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Nº de tokens (≥3 lletres) que comparteixen dos textos normalitzats. */
function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter((t) => t.length >= 3));
  const tb = new Set(b.split(" ").filter((t) => t.length >= 3));
  let n = 0;
  for (const t of ta) if (tb.has(t)) n++;
  return n;
}

/** Data límit de cancel·lació gratuïta = inici − dies (YYYY-MM-DD). null si no reembolsable o falten dades. */
function freeCancellationUntil(startDate: string, days: number | null | undefined, refundable: number | null | undefined): string | null {
  if (!refundable || days == null || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
  const d = new Date(`${startDate}T00:00:00Z`);
  if (isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Empaqueta un objecte com a resultat de tool (text JSON + resum llegible). */
function jsonResult(summary: string, data: unknown) {
  return {
    content: [
      { type: "text" as const, text: summary },
      { type: "text" as const, text: "```json\n" + JSON.stringify(data, null, 2) + "\n```" },
    ],
  };
}

function errResult(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

export function registerTools(server: McpServer, config: AppConfig): void {
  // 1) COBERTURA / desambiguació de ciutat.
  server.registerTool(
    "check_city_coverage",
    {
      title: "Check city coverage (Motion4Rent)",
      annotations: { readOnlyHint: true, openWorldHint: true },
      description:
        "Check whether Motion4Rent operates in a city and disambiguate homonyms (same city name in several countries). " +
        "Use before searching if the country is ambiguous. If the city is NOT covered, do not guess nearby cities: call " +
        "find_nearby_cities_with_coverage with that city's approximate lat/lon to get the real closest covered cities.",
      inputSchema: {
        city: z.string().describe("City name (any language), e.g. 'Barcelona'"),
      },
    },
    async ({ city }) => {
      try {
        const geo = await geocodeCity(config.apiBaseUrl, city);
        if (!geo.places.length) {
          return jsonResult(`No Motion4Rent coverage found for "${city}".`, { city, covered: false, places: [] });
        }
        const covered = true;
        const needsCountry = geo.countries > 1;
        return jsonResult(
          needsCountry
            ? `"${city}" exists in ${geo.countries} countries: specify the country before searching.`
            : `Motion4Rent operates in "${city}".`,
          { city, covered, needs_country_disambiguation: needsCountry, places: geo.places },
        );
      } catch (e) {
        return errResult(`Error checking coverage: ${(e as Error).message}`);
      }
    },
  );

  // 1a) CIUTATS PROPERES AMB COBERTURA (donada una ciutat, coberta o no).
  server.registerTool(
    "find_nearby_cities_with_coverage",
    {
      title: "Find nearby cities with coverage (Motion4Rent)",
      annotations: { readOnlyHint: true, openWorldHint: true },
      description:
        "Given a city (typically one WITHOUT coverage, e.g. Hamburg), returns the CLOSEST cities where Motion4Rent " +
        "actually operates, sorted by distance (km), with country and number of stores. Use this instead of guessing " +
        "nearby cities. IMPORTANT: you MUST pass the approximate 'lat'/'lon' of the named city (you know major-city " +
        "coordinates; for 'nearby' an approximation is fine). If the city itself is covered, you can reuse the lat/lon " +
        "from check_city_coverage's places[]. Then present the real nearest covered cities (do NOT invent coverage or " +
        "distances), and offer to search there. Delivery to the uncovered city itself is NOT available through this " +
        "assistant — for that, give the Motion4Rent contact channels.",
      inputSchema: {
        city: z.string().describe("Name of the reference city (for labelling), e.g. 'Hamburg'."),
        lat: z.number().describe("Approximate latitude of that city (decimal degrees), e.g. 53.55."),
        lon: z.number().describe("Approximate longitude of that city (decimal degrees), e.g. 9.99."),
        radius_km: z
          .number()
          .optional()
          .describe("Max distance in km (default 60, max 300). Increase (e.g. 150) if nothing is found nearby."),
        country: z
          .string()
          .optional()
          .describe("ISO alpha-2 country code (e.g. 'de') to restrict results to one country. Optional."),
      },
    },
    async ({ city, lat, lon, radius_km, country }) => {
      try {
        const places = await nearbyCitiesWithCoverage(config.apiBaseUrl, lat, lon, {
          country,
          radius: radius_km,
          limit: 25,
        });
        if (!places.length) {
          return jsonResult(
            `No Motion4Rent coverage found near "${city}" within ${radius_km ?? 60} km. Try a larger radius_km ` +
              `(e.g. 150) or give the user the Motion4Rent contact channels.`,
            { city, origin: { lat, lon }, radius_km: radius_km ?? 60, count: 0, places: [] },
          );
        }
        const out = places.map((p) => ({
          city: p.cityEn,
          city_es: p.cityEs,
          country: p.country,
          distance_km: p.distanceKm,
          stores: p.stores,
          url: p.url, // slug per a deep-links / search_mobility_rentals
        }));
        const top = out
          .slice(0, 5)
          .map((p) => `${p.city} (${String(p.country).toUpperCase()}, ~${p.distance_km} km)`)
          .join(", ");
        return jsonResult(
          `Nearest Motion4Rent cities to "${city}": ${top}${out.length > 5 ? `, +${out.length - 5} more` : ""}. ` +
            `Offer to search in one of them (use search_mobility_rentals with that city). Delivery to "${city}" itself ` +
            `is NOT available through this assistant; for that, share the Motion4Rent contact channels.`,
          {
            reference_city: city,
            origin: { lat, lon },
            radius_km: radius_km ?? 60,
            count: out.length,
            cities: out,
            note:
              "These are the REAL closest cities with a Motion4Rent store (physical or virtual). Do NOT claim coverage " +
              "for the reference city or any town not in this list, and do NOT invent distances. Being near a covered " +
              "city does not mean delivery to the reference city — offer renting IN a listed city (store pickup or " +
              "delivery within it). For the uncovered place, give the contact channels: form " +
              "https://www.motion4rent.com/contact, email info@motion4rent.com, phone +34 932 20 15 13, WhatsApp +34 931 66 70 77.",
          },
        );
      } catch (e) {
        return errResult(`Error finding nearby cities: ${(e as Error).message}`);
      }
    },
  );

  // 1b) LLISTAT de ciutats amb cobertura (opcionalment per país).
  server.registerTool(
    "list_coverage_cities",
    {
      title: "List cities with coverage (Motion4Rent)",
      annotations: { readOnlyHint: true, openWorldHint: true },
      description:
        "Lists the cities where Motion4Rent operates, optionally filtered by country. Use it to answer 'where do you " +
        "operate?' or 'which cities in <country>?'. Returns city name, country and slug. It does NOT include availability " +
        "or prices — use search_mobility_rentals for a specific city and dates.",
      inputSchema: {
        country: z
          .string()
          .optional()
          .describe("ISO alpha-2 country code (e.g. 'de', 'es') to filter. Omit to list all covered cities."),
      },
    },
    async ({ country }) => {
      try {
        const cities = await listCoverageCities(config.apiBaseUrl, { country });
        if (!cities.length) {
          return jsonResult(
            country
              ? `Motion4Rent has no listed coverage in country "${country}".`
              : `No coverage cities available.`,
            { country: country ?? null, count: 0, cities: [] },
          );
        }
        // Agrupem per país perquè l'assistent pugui presentar-ho net.
        const byCountry: Record<string, string[]> = {};
        for (const c of cities) (byCountry[c.country] ??= []).push(c.cityEn);
        const out = cities.map((c) => ({ city: c.cityEn, country: c.country, url: c.slug }));
        const summary = country
          ? `Motion4Rent operates in ${cities.length} cities in ${country.toUpperCase()}.`
          : `Motion4Rent operates in ${cities.length} cities across ${Object.keys(byCountry).length} countries.`;
        return jsonResult(summary, {
          country: country ?? null,
          count: cities.length,
          by_country: byCountry,
          cities: out,
          note:
            "These are the cities with a Motion4Rent store. To check availability/prices for specific dates, call " +
            "search_mobility_rentals with the city and dates. Do NOT claim coverage for cities not in this list.",
        });
      } catch (e) {
        return errResult(`Error listing coverage cities: ${(e as Error).message}`);
      }
    },
  );

  // 2) CERCA de disponibilitat amb preus + deep-link de reserva.
  server.registerTool(
    "search_mobility_rentals",
    {
      title: "Search mobility rentals (Motion4Rent)",
      annotations: { readOnlyHint: true, openWorldHint: true },
      description:
        "Search available Motion4Rent MOBILITY equipment in a city and date range. Motion4Rent rents mobility aids " +
        "for people with reduced mobility — manual and electric wheelchairs, mobility scooters (electric 3/4-wheel " +
        "scooters for reduced mobility, NOT kick scooters or motorbikes), knee scooters and rollators/walkers. It does " +
        "NOT rent bicycles, e-bikes, motorbikes or cars. Present ONLY the categories this tool actually returns (see " +
        "'product_types_available'/'products'); never claim or imply Motion4Rent offers bikes or any category not " +
        "returned. Each product includes the FINAL total price ('total', already includes the management fee and taxes " +
        "— quote it as-is, do NOT add or estimate fees) and a photo (image_url). Also returns a LINK to the website " +
        "where the user can complete delivery, options and payment (this tool does NOT book or charge). If the city " +
        "name is a homonym across countries, pass 'country'.",
      inputSchema: {
        city: z.string().describe("City, e.g. 'Barcelona'"),
        start_date: DATE.describe("Start date (YYYY-MM-DD)"),
        end_date: DATE.describe("End date (YYYY-MM-DD)"),
        product_type: z
          .string()
          .optional()
          .describe(
            "Free-text product type (e.g. 'electric wheelchair', 'scooter'). Optional. When given, the RESULTS are " +
              "filtered to that type and ALL matching items are returned (up to the cap), instead of a mix of every type.",
          ),
        country: z
          .string()
          .optional()
          .describe("ISO alpha-2 country code (e.g. 'es') to disambiguate homonym cities. Optional."),
        language: z.string().optional().describe("Client language (en, es, fr, de, it, nl, pt...). Default 'en'."),
        currency: z
          .string()
          .optional()
          .describe("Currency to display prices in (one from list_currencies, e.g. 'USD'). Optional; defaults to the product currency."),
        pickup_time: z
          .string()
          .optional()
          .describe("Pickup time HH:MM (e.g. '10:00'). ALWAYS ask the user; affects availability. Default 10:00 if unknown. Stores operate daytime hours, so early-morning/late-night times (e.g. before 08:00 or after 20:00) may return no availability."),
        return_time: z
          .string()
          .optional()
          .describe("Return time HH:MM (e.g. '18:00'). ALWAYS ask the user; affects availability. Default 10:00 if unknown. Stores operate daytime hours, so a late return (e.g. 23:00) may return no availability — that is a TIME limit, not a lack of stock on those dates."),
      },
    },
    async ({ city, start_date, end_date, product_type, country, language, currency, pickup_time, return_time }) => {
      try {
        const lang = language ?? "en";
        const geo = await geocodeCity(config.apiBaseUrl, city);
        if (!geo.places.length) {
          return jsonResult(`No Motion4Rent coverage found for "${city}".`, { city, covered: false });
        }
        // Place selection: filter by country if given; if homonyms and not specified, ask.
        const byCountry = country
          ? geo.places.filter((p) => p.country === country.toLowerCase())
          : geo.places;
        const candidates = byCountry.length ? byCountry : geo.places;
        const distinctCountries = [...new Set(candidates.map((p) => p.country))];
        if (distinctCountries.length > 1) {
          return jsonResult(
            `"${city}" exists in several countries (${distinctCountries.join(", ")}). Call again with 'country'.`,
            { needs_country_disambiguation: true, countries: distinctCountries, places: geo.places },
          );
        }
        const place = candidates[0];
        const locale = apiLocale(lang);

        // Hores EFECTIVES: les demanades per l'usuari (o cap → l'API usa 10:00). Si la cerca amb hores
        // no estàndard surt buida, potser el problema és l'HORA (les botigues operen en horari diürn;
        // l'API exclou la botiga si la recollida/devolució cau fora del seu horari — devolució >20:00 →
        // 0 resultats), NO les dates. Ho distingim amb un probe a hores estàndard (10:00).
        let effSh = toApiTime(pickup_time);
        let effEh = toApiTime(return_time);
        const searchArgs = {
          country: place.country,
          citySlug: place.url || slugCiudad(city),
          start: start_date,
          end: end_date,
          locale,
          type: 0,
          lat: place.lat,
          lon: place.lon,
        };

        let search = await searchResults(config.apiBaseUrl, { ...searchArgs, sh: effSh, eh: effEh });

        // Hores "custom" = alguna hora demanada i diferent de la per defecte (10:00 = "1000").
        const usedCustomTimes = (!!effSh && effSh !== "1000") || (!!effEh && effEh !== "1000");
        // null = no s'han demanat hores concretes; true/false = disponibilitat a les hores demanades.
        let availableAtRequestedTimes: boolean | null = usedCustomTimes ? search.number > 0 : null;
        let timeFallbackUsed = false;
        if (search.number === 0 && usedCustomTimes) {
          // Reintent (una sola vegada) amb hores estàndard per veure si la DATA té stock.
          const probe = await searchResults(config.apiBaseUrl, { ...searchArgs, sh: "1000", eh: "1000" });
          if (probe.number > 0) {
            // La data SÍ té stock: el buit era per l'hora demanada. A partir d'aquí treballem amb 10:00
            // (detall/preu/link coherents amb els resultats que ensenyem).
            search = probe;
            effSh = "1000";
            effEh = "1000";
            timeFallbackUsed = true;
            availableAtRequestedTimes = false;
          }
        }

        const name = lang.toLowerCase().startsWith("es")
          ? place.cityEs ?? place.cityEn ?? city
          : place.cityEn ?? place.cityEs ?? city;

        // Nom ambigu i l'usuari no ha dit país → hem ASSUMIT la ciutat coberta (normalment ES).
        // Font autoritzada: el bloc `homonym` de l'API (taula city_homonyms).
        const confirmCountry = !country && geo.homonymAmbiguous === true;

        const bookingLink = buildResultsLink(config.webBaseUrl, {
          language: lang,
          urlCiudad: place.url || slugCiudad(city),
          inicio: start_date,
          final: end_date,
          // Hores EFECTIVES (si hem fet fallback, 10:00) → el link mostra els mateixos resultats que la tool,
          // no una franja buida. Abans no s'hi passaven i el link sempre anava a 10:00 (incoherent amb 23:00).
          sh: effSh,
          eh: effEh,
          lat: place.lat,
          lon: place.lon,
          name: name ?? undefined,
          types: product_type ? [product_type] : [],
        });

        // Si l'usuari demana un tipus concret (p. ex. "cadira elèctrica"), filtrem els resultats
        // a aquest tipus. L'API retorna TOTS els tipus barrejats (scooters dominen el rànquing),
        // així que sense filtrar només uns pocs del tipus demanat caben dins del sostre.
        let matched = search.productos;
        let typeFilterLabel: string | null = null;
        // Cert si l'usuari ha demanat un tipus concret però NO n'hi ha en aquesta ciutat/dates: llavors
        // ensenyem la resta com a alternativa, però ho senyalitzem perquè l'assistent NO faci passar
        // un altre tipus pel demanat (ni inventi categories) — ha de dir clarament que el tipus demanat
        // no hi és i oferir els que sí que hi ha.
        let requestedTypeNotFound = false;
        if (product_type && product_type.trim()) {
          const pt = normText(product_type);
          // 1) Resol el tipus canònic del catàleg (typesProducts) pel millor solapament de tokens.
          const best = search.typesProducts
            .map((t) => ({ t, score: tokenOverlap(pt, normText(t.name ?? "")) }))
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score)[0];
          const targetName = best ? normText(best.t.name) : null;
          const filtered = search.productos.filter((p) => {
            const pn = normText(p.name ?? "");
            return targetName ? pn === targetName : tokenOverlap(pt, pn) > 0;
          });
          // Només apliquem el filtre si troba coincidències (si no, mostrem la resta però ho marquem).
          if (filtered.length) {
            matched = filtered;
            typeFilterLabel = best?.t.name ?? product_type.trim();
          } else {
            requestedTypeNotFound = true;
          }
        }

        // Enriquim cada producte mostrat amb /details (MODEL + preu EXACTE = details.total = booking = web).
        // El model i el preu-amb-fee NO són al resultat de cerca; per això cal /details per producte.
        // Sostre = MAX_PRODUCTS: mostrem TOTS els del tipus demanat (fins al sostre), no només uns pocs.
        const shown = matched.slice(0, MAX_PRODUCTS);
        const matchedCount = matched.length;
        const target = (currency ?? "").trim().toUpperCase();
        const rateCache = new Map<string, number>();
        const rateFor = async (src: string): Promise<number> => {
          const s = src.toUpperCase();
          if (!target || s === target) return 1;
          let r = rateCache.get(s);
          if (r === undefined) {
            r = await getExchangeRate(config.apiBaseUrl, s, target);
            rateCache.set(s, r);
          }
          return r;
        };

        const productsOut = await Promise.all(
          shown.map(async (p) => {
            // /details → preu/lliurament/pickup/cancel·lació (amb fees). products/load → MODEL + specs reals.
            // (el model i les specs "de veritat" NO són a /details; viuen a products/load, com al web).
            const [detail, load, opts] = await Promise.all([
              getDetails(config.apiBaseUrl, {
                idProductStore: p.id_product_store ?? 0,
                idStore: p.id_store ?? 0,
                idVirtual: p.id_virtual ?? 0,
                start: start_date,
                end: end_date,
                // Hores EFECTIVES (= les de la cerca que ha donat aquests resultats; 10:00 si hi ha hagut
                // fallback) → preu/detall coherents amb la cerca.
                sh: effSh,
                eh: effEh,
                locale,
                // Recàrrec de dia festiu detectat per la cerca → preu del detall correcte (inclou closed_price).
                pickupClosedService: p.pickup_closed_service,
                deliveryClosedService: p.delivery_closed_service,
              }).catch(() => null),
              getProductLoad(config.apiBaseUrl, {
                idProductStore: p.id_product_store ?? 0,
                idVirtual: p.id_virtual ?? 0,
                typeAtt: p.type_att ?? 0,
                radius: p.radius ?? 0,
                sameCity: p.same_city ?? 1,
                idVirtualReal: p.id_virtual_real ?? 0,
              }).catch(() => null),
              // Extres/add-ons: perquè el llistat ja informi que n'hi ha (abans no ho deia fins a demanar-ho).
              getProductOptions(config.apiBaseUrl, p.id_product_store ?? 0).catch(() => []),
            ]);
            const src = (detail?.currency ?? p.currency ?? "EUR").toUpperCase();
            const rate = await rateFor(src);
            // Preu EXACTE de /details (amb fee de gestió). Fallback: base de cerca + fee de gestió.
            const exact =
              detail?.price_total != null
                ? detail.price_total
                : p.total != null
                  ? p.total + config.managementFeeEur + (p.store_extra_fee ?? 0)
                  : null;
            // MODEL: prioritza products/load (brand+model reals), després /details, després el tipus genèric.
            const model =
              load?.title ||
              (detail ? [detail.brand, detail.model].filter(Boolean).join(" ").trim() : "");
            const conv = (v: number | null | undefined) =>
              v == null ? null : Math.round(v * rate * 100) / 100;
            // Resum d'opcions de lliurament (com el bloc "Delivery & pickup" del web).
            const delivery_options: any[] = [];
            if (detail?.pickup_available) delivery_options.push({ label: "Store pickup", price: 0, free: true });
            if (detail?.delivery_available)
              delivery_options.push({
                label: "Home or hotel delivery & pickup",
                price: detail.is_virtual ? 0 : conv(detail.city_delivery_price) ?? 0,
                free: detail.is_virtual || !detail.city_delivery_price,
              });
            for (const ap of detail?.airports ?? [])
              delivery_options.push({ label: `Airport delivery & pickup (${ap.name})`, price: conv(ap.price) ?? 0, free: !ap.price });
            return {
              id_product_store: p.id_product_store,
              id_store: p.id_store,
              id_virtual: p.id_virtual,
              name: model || detail?.name || p.name, // MODEL complet si n'hi ha; si no, el tipus genèric
              type: detail?.type ?? p.name, // tipus de producte (p. ex. "Electric wheelchair")
              // Categoria com el web ("Electric wheelchair · Standard"): tipus + subtipus (atribut "type").
              category: [detail?.type ?? p.name, load?.subtype].filter(Boolean).join(" · ") || null,
              // Specs riques de products/load (pes màx, autonomia, plegable, tipus…) com els badges del web.
              attributes: (load?.attributes?.length ? load.attributes : detail?.attributes) ?? [],
              rating: detail?.rating ?? null,
              reviews: detail?.reviews ?? null,
              total: exact != null ? Math.round(exact * rate * 100) / 100 : null,
              price_per_day: conv(detail?.price_per_day),
              days: detail?.days ?? null,
              currency: target || src,
              image_url: productImageUrl(config.productImageBase, load?.image || p.image),
              delivery_options, // ofereix NOMÉS aquestes (les altres no estan disponibles per aquest article)
              // Extres/add-ons opcionals (buit = cap). Informa'n al llistat; s'afegeixen al preu si es trien.
              extras: (opts ?? []).map((o) => ({
                id: o.id,
                name: o.name,
                price: conv(o.price),
                price_basis: o.type === 1 ? "flat" : "per_day",
              })),
              free_cancellation_until: freeCancellationUntil(start_date, p.cancellation_days, p.cancellation_refundable),
              cancellation_refundable: p.cancellation_refundable,
              cancellation_days: p.cancellation_days,
              // Flags de dia festiu: cal passar-los a create_booking perquè cobri el recàrrec correcte.
              pickup_closed_service: p.pickup_closed_service ? 1 : 0,
              delivery_closed_service: p.delivery_closed_service ? 1 : 0,
            };
          }),
        );

        // Recompte segons si hem filtrat per tipus: si filtrem, comptem els del tipus; si no, el total.
        const effectiveCount = typeFilterLabel ? matchedCount : search.number;
        const truncated = effectiveCount > shown.length;
        const scope = typeFilterLabel ? `${typeFilterLabel} option(s)` : `rental option(s)`;
        const confirmMsg = confirmCountry
          ? ` ⚠️ '${city}' exists in several countries; these results are for ${name} (${place.country.toUpperCase()}). CONFIRM with the user this is the ${place.country.toUpperCase()} city they mean before booking.`
          : "";
        // Tipus demanat però inexistent aquí: cal dir-ho clarament i NO fer passar un altre tipus pel demanat.
        const typeMsg =
          requestedTypeNotFound && product_type
            ? ` ⚠️ Motion4Rent has NO '${product_type}' in ${name} for these dates; the options below are OTHER available mobility categories — tell the user '${product_type}' is not available here and offer these instead. Do NOT relabel them as '${product_type}', and do NOT claim Motion4Rent offers categories it does not rent (e.g. bikes/motorbikes).`
            : "";
        // Hi ha stock a la DATA però NO a l'hora demanada (fallback a hores estàndard): dir-ho clarament
        // i NO atribuir-ho a les dates.
        const timeMsg = timeFallbackUsed
          ? ` ⚠️ TIMES: there IS availability on these dates, but NOT at the requested times (pickup ${pickup_time ?? "?"}, return ${return_time ?? "?"}). Motion4Rent stores operate daytime hours, so that time isn't possible; the options below use standard daytime times (10:00). Tell the user the DATE has stock but their requested time isn't available and they can adjust the time on the website — do NOT say there is no availability on these dates.`
          : "";
        const summary =
          search.number > 0
            ? `Motion4Rent has ${effectiveCount} ${scope} in ${name}, ${place.country.toUpperCase()} (${start_date} → ${end_date}). ` +
              `Showing ${shown.length}${truncated ? ` of ${effectiveCount} (open the booking link for the rest)` : " (all of them)"}.${timeMsg}${typeMsg}${confirmMsg} Booking link: ${bookingLink}`
            : `Motion4Rent has no availability in ${name}, ${place.country.toUpperCase()} for these dates.${confirmMsg} Link to review/other dates: ${bookingLink}`;

        return jsonResult(summary, {
          provider: "Motion4Rent",
          city: name,
          country: place.country,
          // Nom ambigu sense país indicat → confirma amb l'usuari abans de reservar.
          confirm_country: confirmCountry,
          resolved_city: `${name} (${place.country.toUpperCase()})`,
          dates: { start: start_date, end: end_date },
          available: search.number > 0,
          count: effectiveCount,
          total_all_types: search.number,
          type_filter: typeFilterLabel,
          // Tipus demanat per l'usuari i si n'hi ha realment en aquesta ciutat/dates (null si no n'ha demanat cap).
          requested_type: product_type ?? null,
          requested_type_available: product_type ? !requestedTypeNotFound : null,
          // Hores: si l'usuari ha demanat hores concretes, si n'hi ha stock a AQUESTES hores (null si no
          // n'ha demanat). Si és false, la DATA té stock però l'hora demanada no és possible (horari botiga).
          available_at_requested_times: availableAtRequestedTimes,
          requested_pickup_time: pickup_time ?? null,
          requested_return_time: return_time ?? null,
          times_used: { sh: effSh ?? "1000", eh: effEh ?? "1000" },
          time_fallback_used: timeFallbackUsed,
          products: productsOut,
          product_types_available: search.typesProducts,
          booking_link: bookingLink,
          note:
            "DOMAIN: Motion4Rent rents MOBILITY AIDS only (manual/electric wheelchairs, mobility scooters, knee scooters, " +
            "rollators/walkers). It does NOT rent bicycles, e-bikes, motorbikes or cars. Mention ONLY the categories present " +
            "in 'product_types_available'/'products'; NEVER claim it offers bikes or any category not listed here. If " +
            "'requested_type_available' is false, tell the user their requested type is not available in this city/dates and " +
            "offer the categories that ARE returned (do not relabel them as the requested type). " +
            "TIMES: pickup/return time affects availability — stores operate daytime hours and a time outside them (e.g. a " +
            "23:00 return) returns NO results for that time. If 'available_at_requested_times' is false, the DATE HAS stock " +
            "but the requested time is not possible: say EXACTLY that, present the options shown (they use standard daytime " +
            "times, see 'times_used') and suggest adjusting the time on the website — do NOT tell the user there is no " +
            "availability on these dates. " +
            "The city was resolved to 'resolved_city' (name + country) — Motion4Rent's coverage list only knows cities it " +
            "operates in, so it will silently pick the covered one. If 'confirm_country' is true (or the user named a city " +
            "WITHOUT a country that can exist in several countries, e.g. Córdoba ES/AR/MX), CONFIRM with the user this is the " +
            "right country/city before booking; do NOT assume Spain. " +
            "These rentals are offered by MOTION4RENT. 'total' is the FINAL price per product (already includes the " +
            "management fee and taxes) — quote it AS-IS. Do NOT add, estimate or mention any extra fee, and do NOT say " +
            "'from'/'approx'. Present a COMPLETE, RICH card for EACH option — mirror the website: the photo (clickable " +
            "markdown image ![name](image_url)), the 'category' as a small heading ABOVE the name (e.g. 'Electric " +
            "wheelchair · Standard'), the full 'name' (model), the key specs from 'attributes' (label: value, e.g. max " +
            "weight, folding), 'rating'/'reviews' if present (e.g. ★4.6 · 7 reviews), the 'total' plus 'price_per_day'/'days', " +
            "the 'delivery_options' block (label + price, marking free ones as Free — offer ONLY these; delivery exists only " +
            "where a store serves that city, so NEVER offer/imply delivery to a nearby town with no store — for that, give the " +
            "Motion4Rent contact channels: form https://www.motion4rent.com/contact, email info@motion4rent.com, phone +34 932 20 15 13, " +
            "WhatsApp +34 931 66 70 77), any optional " +
            "'extras' (add-ons: name + price + per_day/flat — mention when the list is non-empty so the user knows they exist), and " +
            "'free_cancellation_until' (e.g. 'Free cancellation before <date>'). Do NOT be terse and do NOT collapse these to " +
            "a bare price. Do NOT show internal ids (id_product_store/id_store) or the store name. For the exact breakdown/extras " +
            "call get_rental_details (its price.total matches this 'total'). ⚠️ Each product carries " +
            "pickup_closed_service/delivery_closed_service (holiday surcharge, already reflected in 'total'): you MUST forward " +
            "these SAME values to get_rental_details and create_booking for that product, or the price/charge will be wrong " +
            "on holidays. Payment via create_booking or the website. When 'type_filter' is set, 'products' already contains " +
            "ALL items of that type (up to the cap) — list them all, do NOT show just a few. 'count' is the number of that " +
            "type; 'total_all_types' is every type combined.",
          truncated,
        });
      } catch (e) {
        return errResult(`Error searching availability: ${(e as Error).message}`);
      }
    },
  );

  // 3) DETALL d'un producte concret (specs, preu, cancel·lació).
  server.registerTool(
    "get_rental_details",
    {
      title: "Rental product details (Motion4Rent)",
      annotations: { readOnlyHint: true, openWorldHint: true },
      description:
        "Returns the FULL detail of a MOTION4RENT product: price, deposit, photo (image_url — present it as a clickable " +
        "markdown image ![name](image_url)), the store " +
        "(a 'View location' map link 'map_url' only), ALL delivery types AVAILABLE for THIS product (with price), and the " +
        "options/extras. IMPORTANT: present a 'View location' link (map_url); do NOT reveal the store name, and NEVER show " +
        "internal ids (id_store, id_product_store). Only offer the delivery_options returned here (the rest are not " +
        "available for this item). Use the ids from search_mobility_rentals.",
      inputSchema: {
        id_product_store: z.number().describe("id_product_store from the search result. [Seville test: 559]"),
        id_store: z.number().describe("id_store from the search result. [Seville test: 76]"),
        id_virtual: z.number().describe("id_virtual from the search result (0 if physical store). [test: 0]"),
        start_date: DATE.describe("Start date (YYYY-MM-DD). [test: 2026-07-24]"),
        end_date: DATE.describe("End date (YYYY-MM-DD). [test: 2026-07-24]"),
        language: z.string().optional().describe("Language (en, es, fr...). Default 'en'. [test: es]"),
        currency: z
          .string()
          .optional()
          .describe("Currency to display prices in (one from list_currencies, e.g. 'USD'). Optional; defaults to product currency. [test: USD]"),
        pickup_time: z.string().optional().describe("Pickup time HH:MM. ALWAYS ask the user; affects availability/price. [test: 23:00]"),
        return_time: z.string().optional().describe("Return time HH:MM. ALWAYS ask the user. [test: 23:00]"),
        pickup_closed_service: z.number().optional().describe("Passa el valor de search (0/1). Recàrrec dia festiu; imprescindible per al preu correcte."),
        delivery_closed_service: z.number().optional().describe("Passa el valor de search (0/1). Recàrrec dia festiu."),
      },
    },
    async ({ id_product_store, id_store, id_virtual, start_date, end_date, language, currency, pickup_time, return_time, pickup_closed_service, delivery_closed_service }) => {
      try {
        const [detail, options] = await Promise.all([
          getDetails(config.apiBaseUrl, {
            idProductStore: id_product_store,
            idStore: id_store,
            idVirtual: id_virtual,
            start: start_date,
            end: end_date,
            sh: toApiTime(pickup_time),
            eh: toApiTime(return_time),
            locale: apiLocale(language ?? "en"),
            pickupClosedService: pickup_closed_service === 1,
            deliveryClosedService: delivery_closed_service === 1,
          }),
          getProductOptions(config.apiBaseUrl, id_product_store).catch(() => []),
        ]);
        if (!detail) {
          return jsonResult("No detail found for this product on these dates.", {
            found: false,
            id_product_store,
          });
        }

        // MODEL + specs reals (brand/model, pes màx, autonomia…) vénen de products/load, no de /details.
        const load =
          detail.type_att != null
            ? await getProductLoad(config.apiBaseUrl, {
                idProductStore: id_product_store,
                idVirtual: id_virtual,
                typeAtt: detail.type_att,
                sameCity: detail.same_city ?? 1,
                idVirtualReal: detail.id_virtual_real ?? 0,
              }).catch(() => null)
            : null;

        // Currency: convert with the same 'rate' as booking (1 if not requested or same). Deposit is NOT
        // converted (the preauthorization is held in the supplier's currency).
        const target = (currency ?? "").trim().toUpperCase();
        const src = (detail.currency ?? "EUR").toUpperCase();
        const rate = target && src !== target ? await getExchangeRate(config.apiBaseUrl, src, target) : 1;
        const displayCurrency = rate !== 1 ? target : src;
        const conv = (v: number | null) => (v == null ? null : Math.round(v * rate * 100) / 100);

        // Delivery types ACTUALLY available for this product (only the ones it supports).
        // Virtual stores (id_virtual>0) deliver FREE (price 0), matching payAction/the web.
        const cityPrice = detail.is_virtual ? 0 : conv(detail.city_delivery_price) ?? 0;
        // Recollida a botiga NOMÉS si la botiga en té (les virtuals NO → només lliurament).
        const deliveryOptions: any[] = [];
        if (detail.pickup_available) {
          deliveryOptions.push({ delivery_type: 0, label: "Store pickup", price: 0, free: true });
        }
        if (detail.delivery_available) {
          deliveryOptions.push({ delivery_type: 1, label: "Home delivery", price: cityPrice, needs: ["delivery_address"] });
          deliveryOptions.push({ delivery_type: 2, label: "Hotel delivery", price: cityPrice, needs: ["delivery_address", "hotel_name?"] });
        }
        if (detail.cruise_available) {
          deliveryOptions.push({ delivery_type: 3, label: "Cruise ship delivery", price: cityPrice, needs: ["delivery_address"] });
        }
        if (detail.airports.length) {
          deliveryOptions.push({
            delivery_type: 5,
            label: "Airport delivery",
            airports: detail.airports.map((a) => ({ place_id: a.place_id, name: a.name, price: conv(a.price) })),
            needs: ["airport_place_id", "flight_number"],
          });
        }

        const imageUrl = productImageUrl(config.productImageBase, load?.image || detail.image);
        const modelName = load?.title || [detail.brand, detail.model].filter(Boolean).join(" ").trim();
        const specAttributes = (load?.attributes?.length ? load.attributes : detail.attributes) ?? [];
        const out = {
          provider: "Motion4Rent",
          product: {
            // Nom amb MODEL quan hi és (el 'name' sol ser el tipus genèric). type = categoria.
            name: modelName || detail.name,
            model: modelName || null,
            type: detail.type,
            category: [detail.type, load?.subtype].filter(Boolean).join(" · ") || null, // "Electric wheelchair · Standard"
            attributes: specAttributes, // specs riques (pes màx, autonomia, plegable, tipus…)
            image_url: imageUrl,
          },
          price: {
            currency: displayCurrency,
            total: conv(detail.price_total),
            deposit: detail.deposit,
            deposit_currency: src,
            prepayment_percent: detail.prepayment_percent,
            discount_percent: detail.discount_percent,
          },
          // NOMÉS enllaç de mapa (no exposem el nom del partner; el nom només s'usa per construir el link).
          store: { map_url: storeMapUrl(detail.store_place_id, detail.store_name) },
          delivery_options: deliveryOptions,
          options: options.map((o) => ({
            id: o.id,
            name: o.name,
            price: conv(o.price),
            price_basis: o.type === 1 ? "flat" : "per_day",
          })),
          cancellation: detail.cancellation,
          days: detail.days,
          note:
            "price.total is the EXACT amount charged (base + management fee + taxes; matches the search 'total'). Quote it " +
            "as-is; do NOT add or estimate extra fees. Delivery and any 'options' (optional add-ons/extras) are added on top " +
            "and any discount applied server-side at booking. If 'options' is non-empty, ALWAYS list the available extras " +
            "(name + price + per_day/flat) so the user knows they can add them. Present the product 'name' (the real model), " +
            "the 'category' as a small heading above it, and its 'attributes' (specs: max weight, " +
            "range, folding, type…). When presenting the details, INCLUDE the product photo as a clickable markdown image " +
            "![name](image_url). Do NOT reveal the store name; show only a 'View location' link (map_url). Do NOT show " +
            "internal ids. Offer only these delivery_options.",
        };
        const summary =
          `Motion4Rent — "${detail.name ?? "product"}" (prices in ${displayCurrency}). ` +
          `${deliveryOptions.length} delivery option(s), ${out.options.length} extra(s). ` +
          `Include the photo (image_url) and a 'View location' map link; do not show the store name.`;
        return jsonResult(summary, out);
      } catch (e) {
        return errResult(`Error getting details: ${(e as Error).message}`);
      }
    },
  );

  // 3a) OPCIONS/EXTRES d'un producte (descoberta). Perquè l'assistent les pugui oferir abans de reservar.
  server.registerTool(
    "list_product_options",
    {
      title: "Product options/extras (Motion4Rent)",
      annotations: { readOnlyHint: true, openWorldHint: true },
      description:
        "Returns the optional extras that can be added to a product's booking (e.g. leg rest, basket). Each option has " +
        "an 'id' (passed to create_booking inside 'options_id'), name, price and basis ('flat' or 'per_day'). Price is " +
        "in the product currency; the total in the chosen currency is recomputed server-side at booking. Use the " +
        "id_product_store from search_mobility_rentals.",
      inputSchema: {
        id_product_store: z.number().describe("id_product_store from the search result. [Seville test: 559]"),
      },
    },
    async ({ id_product_store }) => {
      try {
        const options = await getProductOptions(config.apiBaseUrl, id_product_store);
        if (!options.length) {
          return jsonResult("This product has no options/extras.", { id_product_store, options: [] });
        }
        const out = options.map((o) => ({
          id: o.id,
          name: o.name,
          price: o.price,
          price_basis: o.type === 1 ? "flat" : "per_day",
        }));
        return jsonResult(
          `${out.length} option(s) available. Prices in the product currency; the total in the chosen currency is ` +
            `recomputed at booking. Pass the chosen 'id' values to create_booking as 'options_id'.`,
          { id_product_store, options: out },
        );
      } catch (e) {
        return errResult(`Error getting options: ${(e as Error).message}`);
      }
    },
  );

  // 3b) MONEDES actives (dinàmic). Perquè l'assistent pugui oferir/demanar la moneda a l'usuari.
  server.registerTool(
    "list_currencies",
    {
      title: "Available currencies (Motion4Rent)",
      annotations: { readOnlyHint: true, openWorldHint: true },
      description:
        "Returns the currencies the user can PAY in (the platform's customer payment set). Use it to ASK the user " +
        "which currency they want for prices and booking, and pass the chosen 'code' as 'currency' to " +
        "search_mobility_rentals / get_rental_details / create_booking. If not given, the product currency is used.",
      inputSchema: {},
    },
    async () => {
      try {
        const currencies = await getActiveCurrencies(config.apiBaseUrl);
        const labels = currencies.map((c) => `${c.symbol} ${c.code}`).join(", ");
        return jsonResult(
          `Currencies you can pay in: ${labels}. Ask the user which one and pass its 'code' as 'currency'.`,
          { currencies, default: "product currency if none is given" },
        );
      } catch (e) {
        return errResult(`Error getting currencies: ${(e as Error).message}`);
      }
    },
  );

  // 4) POLÍTIQUES / FAQ (cancel·lació, lliurament, dipòsit, assegurança, cobertura…).
  server.registerTool(
    "mobility_policies",
    {
      title: "Policies & FAQ (Motion4Rent)",
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        "Answers general service questions: cancellation, deposit, delivery process and cost, coverage, foldability, " +
        "weight/capacity, public transport/flights, insurance, returns and cities. The official texts are in SPANISH " +
        "(source of truth): ALWAYS translate them to the user's language (pass 'language' with that language). Pass " +
        "'query' to filter; without a query, returns everything.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Question or keywords (e.g. 'cancellation', 'deposit', 'delivery to hotel'). Optional."),
        language: z
          .string()
          .optional()
          .describe("User language (en, es, fr, de, it...). Source text is 'es'; translate it to this language."),
      },
    },
    async ({ query, language }) => {
      const policies = findPolicies(query);
      const lang = (language ?? "").trim();
      const target = lang && !lang.toLowerCase().startsWith("es")
        ? `Translate the texts (source 'es') to '${lang}' before answering the user.`
        : `Official texts in Spanish; translate them to the user's language.`;
      const summary = query
        ? `${policies.length} relevant policy(ies) for "${query}". ${target}`
        : `All policies (${policies.length}). ${target}`;
      return jsonResult(
        summary,
        policies.map((p) => ({ topic: p.topic, title: p.title, text: p.text, source_language: "es" })),
      );
    },
  );

  // 5) BOOKING amb pagament (Fase 3A) — NOMÉS si està configurat (checkoutBaseUrl + secret).
  //    Cas acotat: recollida a botiga, sense extres. Crea el hold i torna la urlTpv de Stripe.
  if (config.checkoutBaseUrl && config.checkoutSecret) {
    server.registerTool(
      "create_booking",
      {
        title: "Create booking with payment link (Motion4Rent)",
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        description:
          "Prepares the booking and returns a Stripe PAYMENT LINK (urlTpv) the user opens to pay. The booking is " +
          "FORMALIZED when the user pays (until then only the link exists). Do NOT use internal terms like 'hold' with " +
          "the user; say the booking is confirmed upon payment. Default STORE PICKUP; optionally CITY delivery " +
          "(delivery_type 1 home / 2 hotel / 3 cruise, with delivery_address) or AIRPORT (5, with airport_place_id + " +
          "flight_number). Offer ONLY the delivery types get_rental_details reports as available. Add options/extras with " +
          "'options_id' (from list_product_options). The server prices product, options and delivery. ALWAYS ask the user " +
          "for the PICKUP time and RETURN time (pickup_time/return_time, HH:MM) — never assume them. Before calling it, " +
          "ASK for the user's consent and data (first/last name, email, phone with prefix, country, pickup & return times), e.g.: «Shall I " +
          "prepare the booking and generate the payment link? The booking is confirmed once you pay.» Use the ids from " +
          "search_mobility_rentals. The server recomputes the price (do NOT send it). The user may pay a DEPOSIT now and " +
          "the rest at pickup: tell them the breakdown (pay_now / pay_at_pickup). Some bookings stay pending store " +
          "confirmation after payment. ERROR 'delivery_type_not_available' means THIS PRODUCT/STORE does not offer that " +
          "delivery type — it is NOT about the address: offer store pickup or the booking_link, do not blame the address. " +
          "If the response indicates fallback (supplier requires the full checkout), use the 'booking_link' from " +
          "search_mobility_rentals instead. ⚠️ COVERAGE (critical): delivery ONLY exists where there is a store (physical or " +
          "virtual) that serves that place — i.e. the delivery_options returned for that city. Being NEAR a covered city is " +
          "NOT enough: NEVER offer or imply delivery to a town/address that has no store of its own, and NEVER create a " +
          "booking to 'check' coverage or a distance surcharge (the server does NOT validate address coverage). You MAY " +
          "suggest renting in the nearest covered city (store pickup or delivery WITHIN that city), but for the uncovered " +
          "place you MUST tell the user delivery there is not available through this assistant and give ALL Motion4Rent " +
          "contact channels: contact form https://www.motion4rent.com/contact, email info@motion4rent.com, phone (calls) " +
          "+34 932 20 15 13, and WhatsApp +34 931 66 70 77 (different number — offer both). Do NOT invent coverage or surcharges.",
        inputSchema: {
          id_product_store: z.number().describe("id_product_store from the search result. [Seville test: 559]"),
          id_store: z.number().describe("id_store from the search result. [Seville test: 76]"),
          id_virtual: z.number().describe("id_virtual from the search result (0 if physical store). [test: 0]"),
          start_date: DATE.describe("Start date (YYYY-MM-DD). [test: 2026-07-24]"),
          end_date: DATE.describe("End date (YYYY-MM-DD). [test: 2026-07-24]"),
          pickup_time: z.string().optional().describe("Pickup time HH:MM. You MUST ask the user before booking. [test: 23:00]"),
          return_time: z.string().optional().describe("Return time HH:MM. You MUST ask the user before booking. [test: 23:00]"),
          pickup_closed_service: z.number().optional().describe("Passa el valor de search/get_rental_details (0/1). Recàrrec dia festiu; sense això la reserva infravalora."),
          delivery_closed_service: z.number().optional().describe("Passa el valor de search/get_rental_details (0/1). Recàrrec dia festiu."),
          customer: z
            .object({
              first_name: z.string().describe("First name. [test: Test]"),
              last_name: z.string().describe("Last name. [test: MCP]"),
              email: z.string().describe("Email. [test: test@motion4rent.com]"),
              phone: z.string().describe("Phone (without prefix). [test: 600000000]"),
              phone_prefix: z.string().optional().describe("International prefix, e.g. '+34'. [test: +34]"),
              country: z.string().describe("ISO alpha-2 country code, e.g. 'ES'. [test: ES]"),
            })
            .describe("Customer data (with consent)"),
          language: z.string().optional().describe("Language (en, es, fr...). Default 'en'. [test: es]"),
          currency: z
            .string()
            .optional()
            .describe("Payment currency (one from list_currencies, e.g. 'USD'). Optional; defaults to product currency. Server validates and recomputes. [test: USD]"),
          options_id: z
            .array(z.number())
            .optional()
            .describe("Option/extra ids to add (from list_product_options). The server prices them. Optional. [test: [1710,1711]]"),
          delivery_type: z
            .number()
            .optional()
            .describe("Delivery: 0 (or omitted) store pickup (free), 1 home, 2 hotel, 3 cruise (city), 5 airport. Only use types get_rental_details reports as available."),
          delivery_address: z
            .string()
            .optional()
            .describe("Delivery address/point (for cruise: port/dock). REQUIRED if delivery_type is 1, 2 or 3."),
          hotel_name: z
            .string()
            .optional()
            .describe("Hotel name (optional, if delivery_type is 2)."),
          airport_place_id: z
            .string()
            .optional()
            .describe("Airport place_id (from get_rental_details.airports). REQUIRED if delivery_type is 5."),
          flight_number: z
            .string()
            .optional()
            .describe("Flight number. REQUIRED if delivery_type is 5."),
          newsletter: z.boolean().optional().describe("Newsletter consent. Optional."),
          comments: z.string().optional().describe("Comments for the store. Optional."),
        },
      },
      async ({ id_product_store, id_store, id_virtual, start_date, end_date, pickup_time, return_time, pickup_closed_service, delivery_closed_service, customer, language, currency, options_id, delivery_type, delivery_address, hotel_name, airport_place_id, flight_number, newsletter, comments }) => {
        try {
          const r = await createBooking(config.checkoutBaseUrl, config.checkoutSecret, {
            idProductStore: id_product_store,
            idStore: id_store,
            idVirtual: id_virtual,
            start: start_date,
            end: end_date,
            sh: toApiTime(pickup_time),
            eh: toApiTime(return_time),
            locale: apiLocale(language ?? "en"),
            customer: {
              firstName: customer.first_name,
              lastName: customer.last_name,
              email: customer.email,
              phone: customer.phone,
              prefix: customer.phone_prefix,
              country: customer.country,
            },
            newsletter,
            comments,
            currency,
            optionsId: options_id,
            deliveryType: delivery_type,
            deliveryAddress: delivery_address,
            hotelName: hotel_name,
            airportPlaceId: airport_place_id,
            flightNumber: flight_number,
            pickupClosedService: pickup_closed_service === 1,
            deliveryClosedService: delivery_closed_service === 1,
          });

          if (r.fallbackDeeplink) {
            return jsonResult(
              "This supplier requires the full website checkout. Use the 'booking_link' from search_mobility_rentals.",
              { created: false, fallback_deeplink: true },
            );
          }
          if (!r.ok) {
            const hint =
              r.error === "delivery_type_not_available"
                ? " (this product/store does not offer that delivery type — NOT an address issue; offer store pickup or the booking_link)"
                : "";
            return errResult(`Could not create the booking (${r.status}): ${r.error ?? "unknown error"}.${hint}`);
          }

          return jsonResult(
            `Payment link ready (ref. ${r.increment_id}): ${r.urlTpv}. The booking is FORMALIZED once the user pays. ` +
              `The user pays ${r.pay_now} now` +
              (r.pay_at_pickup ? ` and ${r.pay_at_pickup} at pickup` : "") +
              `. Present the link and the breakdown; do NOT use the term 'hold'.`,
            {
              created: true,
              increment_id: r.increment_id,
              payment_link: r.urlTpv,
              total: r.total,
              pay_now: r.pay_now,
              pay_at_pickup: r.pay_at_pickup,
              prepayment_percent: r.prepayment_pct,
              free_cancellation_until: r.free_cancellation_until,
              note:
                "The user completes payment at payment_link and then the booking is formalized. After payment, " +
                "depending on the supplier it may stay pending store confirmation (warn the user). Do not use 'hold'.",
            },
          );
        } catch (e) {
          return errResult(`Error creating the booking: ${(e as Error).message}`);
        }
      },
    );
  }
}
