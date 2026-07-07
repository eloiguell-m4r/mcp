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
  searchResults,
  getDetails,
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

/**
 * Descarrega una imatge i la retorna com a content block MCP (base64) perquè el client la MOSTRI
 * (una URL de text no es renderitza; un bloc image sí). null si falla, no és imatge o és massa gran.
 */
async function imageContentBlock(url: string | null | undefined) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const mime = res.headers.get("content-type") ?? "image/jpeg";
    if (!mime.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 900_000) return null; // evita payloads enormes al client
    return { type: "image" as const, data: buf.toString("base64"), mimeType: mime };
  } catch {
    return null;
  }
}

export function registerTools(server: McpServer, config: AppConfig): void {
  // 1) COBERTURA / desambiguació de ciutat.
  server.registerTool(
    "check_city_coverage",
    {
      title: "Check city coverage (Motion4Rent)",
      description:
        "Check whether Motion4Rent operates in a city and disambiguate homonyms (same city name in several countries). " +
        "Use before searching if the country is ambiguous.",
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

  // 2) CERCA de disponibilitat amb preus + deep-link de reserva.
  server.registerTool(
    "search_mobility_rentals",
    {
      title: "Search mobility rentals (Motion4Rent)",
      description:
        "Search available Motion4Rent mobility equipment (wheelchairs, scooters, etc.) in a city and date range, " +
        "with total price per product and a photo (image_url). Also returns a LINK to the website where the user can " +
        "complete delivery, options and payment (this tool does NOT book or charge). If the city name is a homonym " +
        "across countries, pass 'country'.",
      inputSchema: {
        city: z.string().describe("City, e.g. 'Barcelona'"),
        start_date: DATE.describe("Start date (YYYY-MM-DD)"),
        end_date: DATE.describe("End date (YYYY-MM-DD)"),
        product_type: z
          .string()
          .optional()
          .describe("Free-text product type (e.g. 'electric wheelchair'). Optional; filters the link."),
        country: z
          .string()
          .optional()
          .describe("ISO alpha-2 country code (e.g. 'es') to disambiguate homonym cities. Optional."),
        language: z.string().optional().describe("Client language (en, es, fr, de, it, nl, pt...). Default 'en'."),
        currency: z
          .string()
          .optional()
          .describe("Currency to display prices in (one from list_currencies, e.g. 'USD'). Optional; defaults to the product currency."),
      },
    },
    async ({ city, start_date, end_date, product_type, country, language, currency }) => {
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

        const search = await searchResults(config.apiBaseUrl, {
          country: place.country,
          citySlug: place.url || slugCiudad(city),
          start: start_date,
          end: end_date,
          locale,
          type: 0,
          lat: place.lat,
          lon: place.lon,
        });

        const name = lang.toLowerCase().startsWith("es")
          ? place.cityEs ?? place.cityEn ?? city
          : place.cityEn ?? place.cityEs ?? city;

        const bookingLink = buildResultsLink(config.webBaseUrl, {
          language: lang,
          urlCiudad: place.url || slugCiudad(city),
          inicio: start_date,
          final: end_date,
          lat: place.lat,
          lon: place.lon,
          name: name ?? undefined,
          types: product_type ? [product_type] : [],
        });

        const productos = search.productos.slice(0, MAX_PRODUCTS);

        // Conversió de preus a la moneda demanada (mateix 'rate' que el web; el booking recalcula igual).
        const target = (currency ?? "").trim().toUpperCase();
        if (target) {
          const rateCache = new Map<string, number>();
          for (const p of productos) {
            const src = (p.currency ?? "EUR").toUpperCase();
            if (p.total != null && src !== target) {
              let rate = rateCache.get(src);
              if (rate === undefined) {
                rate = await getExchangeRate(config.apiBaseUrl, src, target);
                rateCache.set(src, rate);
              }
              p.total = Math.round(p.total * rate * 100) / 100;
            }
            p.currency = target;
          }
        }

        const truncated = search.productos.length > MAX_PRODUCTS;
        const productsOut = productos.map((p) => ({
          ...p,
          image_url: productImageUrl(config.productImageBase, p.image),
        }));
        const summary =
          search.number > 0
            ? `Motion4Rent has ${search.number} rental option(s) in ${name} (${start_date} → ${end_date}). ` +
              `Showing ${productos.length}${truncated ? " (truncated)" : ""}. Booking link: ${bookingLink}`
            : `Motion4Rent has no availability in ${name} for these dates. Link to review/other dates: ${bookingLink}`;

        return jsonResult(summary, {
          provider: "Motion4Rent",
          city: name,
          country: place.country,
          dates: { start: start_date, end: end_date },
          available: search.number > 0,
          count: search.number,
          products: productsOut,
          product_types_available: search.typesProducts,
          booking_link: bookingLink,
          note:
            "These rentals are offered by MOTION4RENT. Show the photo (image_url) and the name; do NOT show internal " +
            "ids (id_product_store/id_store) to the user. For full detail (store+map, delivery, extras) call " +
            "get_rental_details with these ids. Payment happens on the website or via create_booking.",
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
      description:
        "Returns the FULL detail of a MOTION4RENT product: price, deposit, photo (image_url + an inline image), the store " +
        "(name + map link 'map_url'), ALL delivery types AVAILABLE for THIS product (with price), and the options/extras. " +
        "IMPORTANT: present the store NAME and map_url to the user; NEVER show internal ids (id_store, id_product_store). " +
        "Only offer the delivery_options returned here (the rest are not available for this item). Use the ids from " +
        "search_mobility_rentals.",
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
      },
    },
    async ({ id_product_store, id_store, id_virtual, start_date, end_date, language, currency }) => {
      try {
        const [detail, options] = await Promise.all([
          getDetails(config.apiBaseUrl, {
            idProductStore: id_product_store,
            idStore: id_store,
            idVirtual: id_virtual,
            start: start_date,
            end: end_date,
            locale: apiLocale(language ?? "en"),
          }),
          getProductOptions(config.apiBaseUrl, id_product_store).catch(() => []),
        ]);
        if (!detail) {
          return jsonResult("No detail found for this product on these dates.", {
            found: false,
            id_product_store,
          });
        }

        // Currency: convert with the same 'rate' as booking (1 if not requested or same). Deposit is NOT
        // converted (the preauthorization is held in the supplier's currency).
        const target = (currency ?? "").trim().toUpperCase();
        const src = (detail.currency ?? "EUR").toUpperCase();
        const rate = target && src !== target ? await getExchangeRate(config.apiBaseUrl, src, target) : 1;
        const displayCurrency = rate !== 1 ? target : src;
        const conv = (v: number | null) => (v == null ? null : Math.round(v * rate * 100) / 100);

        // Delivery types ACTUALLY available for this product (only the ones it supports).
        const cityPrice = conv(detail.city_delivery_price) ?? 0;
        const deliveryOptions: any[] = [{ delivery_type: 0, label: "Store pickup", price: 0, free: true }];
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

        const imageUrl = productImageUrl(config.productImageBase, detail.image);
        const out = {
          provider: "Motion4Rent",
          product: { name: detail.name, type: detail.type, image_url: imageUrl },
          price: {
            currency: displayCurrency,
            total: conv(detail.price_total),
            deposit: detail.deposit,
            deposit_currency: src,
            prepayment_percent: detail.prepayment_percent,
            discount_percent: detail.discount_percent,
          },
          store: { name: detail.store_name, map_url: storeMapUrl(detail.store_place_id, detail.store_name) },
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
            "Show the store NAME and map_url to the user; do NOT show internal ids. Offer only these delivery_options. " +
            "The final total (with delivery/options/currency) is recomputed server-side at booking.",
        };
        const summary =
          `Motion4Rent — "${detail.name ?? "product"}" at ${detail.store_name ?? "the store"} (prices in ${displayCurrency}). ` +
          `${deliveryOptions.length} delivery option(s), ${out.options.length} extra(s).`;
        // Include an inline image so the client SHOWS the photo (a text URL isn't rendered).
        const img = await imageContentBlock(imageUrl);
        const content: any[] = [{ type: "text" as const, text: summary }];
        if (img) content.push(img);
        content.push({ type: "text" as const, text: "```json\n" + JSON.stringify(out, null, 2) + "\n```" });
        return { content };
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
      description:
        "Returns the currencies the user can view prices and pay in (dynamic platform list). Use it to ASK the user " +
        "which currency they want for prices and booking, and pass the chosen one as 'currency' to " +
        "search_mobility_rentals / get_rental_details / create_booking. If not given, the product currency is used.",
      inputSchema: {},
    },
    async () => {
      try {
        const currencies = await getActiveCurrencies(config.apiBaseUrl);
        return jsonResult(
          `Available currencies: ${currencies.join(", ")}. Ask the user which one and pass it as 'currency'.`,
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
        description:
          "Prepares the booking and returns a Stripe PAYMENT LINK (urlTpv) the user opens to pay. The booking is " +
          "FORMALIZED when the user pays (until then only the link exists). Do NOT use internal terms like 'hold' with " +
          "the user; say the booking is confirmed upon payment. Default STORE PICKUP; optionally CITY delivery " +
          "(delivery_type 1 home / 2 hotel / 3 cruise, with delivery_address) or AIRPORT (5, with airport_place_id + " +
          "flight_number). Offer ONLY the delivery types get_rental_details reports as available. Add options/extras with " +
          "'options_id' (from list_product_options). The server prices product, options and delivery. Before calling it, " +
          "ASK for the user's consent and data (first/last name, email, phone with prefix, country), e.g.: «Shall I " +
          "prepare the booking and generate the payment link? The booking is confirmed once you pay.» Use the ids from " +
          "search_mobility_rentals. The server recomputes the price (do NOT send it). The user may pay a DEPOSIT now and " +
          "the rest at pickup: tell them the breakdown (pay_now / pay_at_pickup). Some bookings stay pending store " +
          "confirmation after payment. ERROR 'delivery_type_not_available' means THIS PRODUCT/STORE does not offer that " +
          "delivery type — it is NOT about the address: offer store pickup or the booking_link, do not blame the address. " +
          "If the response indicates fallback (supplier requires the full checkout), use the 'booking_link' from " +
          "search_mobility_rentals instead.",
        inputSchema: {
          id_product_store: z.number().describe("id_product_store from the search result. [Seville test: 559]"),
          id_store: z.number().describe("id_store from the search result. [Seville test: 76]"),
          id_virtual: z.number().describe("id_virtual from the search result (0 if physical store). [test: 0]"),
          start_date: DATE.describe("Start date (YYYY-MM-DD). [test: 2026-07-24]"),
          end_date: DATE.describe("End date (YYYY-MM-DD). [test: 2026-07-24]"),
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
      async ({ id_product_store, id_store, id_virtual, start_date, end_date, customer, language, currency, options_id, delivery_type, delivery_address, hotel_name, airport_place_id, flight_number, newsletter, comments }) => {
        try {
          const r = await createBooking(config.checkoutBaseUrl, config.checkoutSecret, {
            idProductStore: id_product_store,
            idStore: id_store,
            idVirtual: id_virtual,
            start: start_date,
            end: end_date,
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
