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

export function registerTools(server: McpServer, config: AppConfig): void {
  // 1) COBERTURA / desambiguació de ciutat.
  server.registerTool(
    "check_city_coverage",
    {
      title: "Comprova cobertura de ciutat",
      description:
        "Comprova si Motion4Rent dona servei en una ciutat i resol homònimes (mateixa ciutat en diversos països). " +
        "Usa-ho abans de cercar si el país és ambigu.",
      inputSchema: {
        city: z.string().describe("Nom de la ciutat (qualsevol idioma), p. ex. 'Barcelona'"),
      },
    },
    async ({ city }) => {
      try {
        const geo = await geocodeCity(config.apiBaseUrl, city);
        if (!geo.places.length) {
          return jsonResult(`No consta cobertura per a "${city}".`, { city, covered: false, places: [] });
        }
        const covered = true;
        const needsCountry = geo.countries > 1;
        return jsonResult(
          needsCountry
            ? `"${city}" existeix en ${geo.countries} països: cal especificar el país abans de cercar.`
            : `Motion4Rent dona servei a "${city}".`,
          { city, covered, needs_country_disambiguation: needsCountry, places: geo.places },
        );
      } catch (e) {
        return errResult(`Error comprovant cobertura: ${(e as Error).message}`);
      }
    },
  );

  // 2) CERCA de disponibilitat amb preus + deep-link de reserva.
  server.registerTool(
    "search_mobility_rentals",
    {
      title: "Cerca lloguers de mobilitat",
      description:
        "Cerca equips de mobilitat disponibles (cadires de rodes, scooters, etc.) en una ciutat i unes dates, " +
        "amb preu total per producte. Retorna també un ENLLAÇ a la web on l'usuari completa lliurament, opcions i " +
        "pagament (aquesta tool NO reserva ni cobra). Si la ciutat és homònima en diversos països, indica'l a 'country'.",
      inputSchema: {
        city: z.string().describe("Ciutat, p. ex. 'Barcelona'"),
        start_date: DATE.describe("Data d'inici (YYYY-MM-DD)"),
        end_date: DATE.describe("Data de fi (YYYY-MM-DD)"),
        product_type: z
          .string()
          .optional()
          .describe("Tipus de producte en text lliure (p. ex. 'silla de ruedas eléctrica'). Opcional; filtra l'enllaç."),
        country: z
          .string()
          .optional()
          .describe("Codi de país ISO alpha-2 (p. ex. 'es') per desambiguar ciutats homònimes. Opcional."),
        language: z.string().optional().describe("Idioma del client (en, es, fr, de, it, nl, pt...). Per defecte 'en'."),
        currency: z
          .string()
          .optional()
          .describe("Moneda per mostrar els preus (una de list_currencies, p. ex. 'USD'). Opcional; per defecte la del producte."),
      },
    },
    async ({ city, start_date, end_date, product_type, country, language, currency }) => {
      try {
        const lang = language ?? "en";
        const geo = await geocodeCity(config.apiBaseUrl, city);
        if (!geo.places.length) {
          return jsonResult(`No consta cobertura per a "${city}".`, { city, covered: false });
        }
        // Selecció de lloc: filtra per país si es dona; si hi ha homònimes i no s'ha concretat, demana-ho.
        const byCountry = country
          ? geo.places.filter((p) => p.country === country.toLowerCase())
          : geo.places;
        const candidates = byCountry.length ? byCountry : geo.places;
        const distinctCountries = [...new Set(candidates.map((p) => p.country))];
        if (distinctCountries.length > 1) {
          return jsonResult(
            `"${city}" existeix en diversos països (${distinctCountries.join(", ")}). Torna a cridar amb 'country'.`,
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
            ? `Motion4Rent té ${search.number} opció(ns) de lloguer a ${name} (${start_date} → ${end_date}). ` +
              `Mostro ${productos.length}${truncated ? " (retallat)" : ""}. Enllaç per reservar: ${bookingLink}`
            : `Motion4Rent no té disponibilitat a ${name} per a aquestes dates. Enllaç per revisar/altres dates: ${bookingLink}`;

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
            "Aquests lloguers els ofereix MOTION4RENT. Mostra la foto (image_url) i el nom; NO mostris els ids interns " +
            "(id_product_store/id_store) a l'usuari. Per al detall complet (botiga+mapa, lliurament, extres) crida " +
            "get_rental_details amb aquests ids. El pagament es fa a la web o amb create_booking.",
          truncated,
        });
      } catch (e) {
        return errResult(`Error cercant disponibilitat: ${(e as Error).message}`);
      }
    },
  );

  // 3) DETALL d'un producte concret (specs, preu, cancel·lació).
  server.registerTool(
    "get_rental_details",
    {
      title: "Detall d'un producte de lloguer",
      description:
        "Retorna el detall COMPLET d'un producte de MOTION4RENT: preu, fiança, foto (image_url), la botiga " +
        "(nom + enllaç de mapa 'map_url'), TOTS els tipus de lliurament DISPONIBLES per a AQUEST producte (amb preu) " +
        "i les opcions/extres. IMPORTANT: presenta a l'usuari el NOM de la botiga i el map_url; NO mostris mai els " +
        "identificadors interns (id_store, id_product_store). Ofereix només els delivery_options que retorna (la resta " +
        "no els admet aquest article). Usa els ids obtinguts de search_mobility_rentals.",
      inputSchema: {
        id_product_store: z.number().describe("id_product_store del resultat de cerca. [prova Sevilla: 559]"),
        id_store: z.number().describe("id_store del resultat de cerca. [prova Sevilla: 76]"),
        id_virtual: z.number().describe("id_virtual del resultat de cerca (0 si botiga física). [prova: 0]"),
        start_date: DATE.describe("Data d'inici (YYYY-MM-DD). [prova: 2026-07-24]"),
        end_date: DATE.describe("Data de fi (YYYY-MM-DD). [prova: 2026-07-24]"),
        language: z.string().optional().describe("Idioma (en, es, fr...). Per defecte 'en'. [prova: es]"),
        currency: z
          .string()
          .optional()
          .describe("Moneda per mostrar els preus (una de list_currencies, p. ex. 'USD'). Opcional; per defecte la del producte. [prova: USD]"),
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
          return jsonResult("No s'ha trobat el detall d'aquest producte per a aquestes dates.", {
            found: false,
            id_product_store,
          });
        }

        // Moneda: converteix amb el mateix 'rate' que el booking (1 si no es demana o és la mateixa).
        // La fiança NO es converteix (la preautorització es reté en la moneda del proveïdor).
        const target = (currency ?? "").trim().toUpperCase();
        const src = (detail.currency ?? "EUR").toUpperCase();
        const rate = target && src !== target ? await getExchangeRate(config.apiBaseUrl, src, target) : 1;
        const displayCurrency = rate !== 1 ? target : src;
        const conv = (v: number | null) => (v == null ? null : Math.round(v * rate * 100) / 100);

        // Tipus de lliurament REALMENT disponibles per aquest producte (només els que admet).
        const cityPrice = conv(detail.city_delivery_price) ?? 0;
        const deliveryOptions: any[] = [{ delivery_type: 0, label: "Recollida a botiga", price: 0, free: true }];
        if (detail.delivery_available) {
          deliveryOptions.push({ delivery_type: 1, label: "Lliurament a domicili", price: cityPrice, needs: ["delivery_address"] });
          deliveryOptions.push({ delivery_type: 2, label: "Lliurament a hotel", price: cityPrice, needs: ["delivery_address", "hotel_name?"] });
        }
        if (detail.cruise_available) {
          deliveryOptions.push({ delivery_type: 3, label: "Lliurament a creuer", price: cityPrice, needs: ["delivery_address"] });
        }
        if (detail.airports.length) {
          deliveryOptions.push({
            delivery_type: 5,
            label: "Lliurament a aeroport",
            airports: detail.airports.map((a) => ({ place_id: a.place_id, name: a.name, price: conv(a.price) })),
            needs: ["airport_place_id", "flight_number"],
          });
        }

        const out = {
          provider: "Motion4Rent",
          product: {
            name: detail.name,
            type: detail.type,
            image_url: productImageUrl(config.productImageBase, detail.image),
          },
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
            price_basis: o.type === 1 ? "fix" : "per_dia",
          })),
          cancellation: detail.cancellation,
          days: detail.days,
          note:
            "Presenta el NOM de la botiga i el map_url a l'usuari; NO mostris ids interns. Ofereix només aquests " +
            "delivery_options. El total final (amb lliurament/opcions/moneda) el recalcula el servidor en reservar.",
        };
        return jsonResult(
          `Motion4Rent — "${detail.name ?? "producte"}" a ${detail.store_name ?? "la botiga"} (preus en ${displayCurrency}). ` +
            `${deliveryOptions.length} opció(ns) de lliurament, ${out.options.length} extra(s).`,
          out,
        );
      } catch (e) {
        return errResult(`Error obtenint el detall: ${(e as Error).message}`);
      }
    },
  );

  // 3a) OPCIONS/EXTRES d'un producte (descoberta). Perquè l'assistent les pugui oferir abans de reservar.
  server.registerTool(
    "list_product_options",
    {
      title: "Opcions/extres disponibles d'un producte",
      description:
        "Retorna les opcions/extres que es poden afegir a la reserva d'un producte (p. ex. reposapeus, cistella). " +
        "Cada opció porta un 'id' (que després es passa a create_booking dins 'options_id'), nom, preu i base " +
        "('fix' o 'per_dia'). El preu és en la moneda del producte; el total en la moneda triada es recalcula al " +
        "servidor en reservar. Usa l'id_product_store obtingut de search_mobility_rentals.",
      inputSchema: {
        id_product_store: z.number().describe("id_product_store del resultat de cerca. [prova Sevilla: 559]"),
      },
    },
    async ({ id_product_store }) => {
      try {
        const options = await getProductOptions(config.apiBaseUrl, id_product_store);
        if (!options.length) {
          return jsonResult("Aquest producte no té opcions/extres.", { id_product_store, options: [] });
        }
        const out = options.map((o) => ({
          id: o.id,
          name: o.name,
          price: o.price,
          price_basis: o.type === 1 ? "fix" : "per_dia",
        }));
        return jsonResult(
          `${out.length} opció(ns) disponibles. Preus en la moneda del producte; el total en la moneda triada es ` +
            `recalcula en reservar. Passa els 'id' triats a create_booking com 'options_id'.`,
          { id_product_store, options: out },
        );
      } catch (e) {
        return errResult(`Error obtenint les opcions: ${(e as Error).message}`);
      }
    },
  );

  // 3b) MONEDES actives (dinàmic). Perquè l'assistent pugui oferir/demanar la moneda a l'usuari.
  server.registerTool(
    "list_currencies",
    {
      title: "Monedes disponibles",
      description:
        "Retorna les monedes en què l'usuari pot veure preus i pagar (llista dinàmica de la plataforma). " +
        "Usa-la per DEMANAR a l'usuari en quina moneda vol els preus i la reserva, i passa la triada com a 'currency' " +
        "a search_mobility_rentals / get_rental_details / create_booking. Si no s'indica, s'usa la moneda del producte.",
      inputSchema: {},
    },
    async () => {
      try {
        const currencies = await getActiveCurrencies(config.apiBaseUrl);
        return jsonResult(
          `Monedes disponibles: ${currencies.join(", ")}. Pregunta a l'usuari quina vol i passa-la com a 'currency'.`,
          { currencies, default: "moneda del producte si no se n'indica cap" },
        );
      } catch (e) {
        return errResult(`Error obtenint les monedes: ${(e as Error).message}`);
      }
    },
  );

  // 4) POLÍTIQUES / FAQ (cancel·lació, lliurament, dipòsit, assegurança, cobertura…).
  server.registerTool(
    "mobility_policies",
    {
      title: "Polítiques i preguntes freqüents de Motion4Rent",
      description:
        "Respon preguntes generals sobre el servei: cancel·lació, fiança/dipòsit, procés i cost de lliurament, " +
        "cobertura, plegabilitat, pes/capacitat, transport públic/avió, assegurança, devolució i ciutats. " +
        "Els textos oficials estan en ESPANYOL (font de veritat): tradueix-los SEMPRE a l'idioma de l'usuari " +
        "(passa 'language' amb aquest idioma). Passa 'query' per filtrar; sense query, torna tot.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Pregunta o paraules clau (p. ex. 'cancelación', 'deposit', 'delivery to hotel'). Opcional."),
        language: z
          .string()
          .optional()
          .describe("Idioma de l'usuari (en, es, fr, de, it...). El text font ve en 'es'; tradueix-lo a aquest idioma."),
      },
    },
    async ({ query, language }) => {
      const policies = findPolicies(query);
      const lang = (language ?? "").trim();
      const target = lang && !lang.toLowerCase().startsWith("es")
        ? `Tradueix els textos (font 'es') a '${lang}' abans de respondre a l'usuari.`
        : `Textos oficials en espanyol; tradueix-los a l'idioma de l'usuari.`;
      const summary = query
        ? `${policies.length} política(es) rellevant(s) per a "${query}". ${target}`
        : `Totes les polítiques (${policies.length}). ${target}`;
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
        title: "Crea una reserva amb enllaç de pagament (recollida a botiga)",
        description:
          "Crea una reserva en estat 'hold' i retorna un ENLLAÇ DE PAGAMENT Stripe (urlTpv) que l'usuari obre per pagar. " +
          "Per defecte RECOLLIDA A BOTIGA; opcionalment lliurament a CIUTAT (delivery_type 1 domicili / 2 hotel, amb delivery_address). " +
          "Pots afegir opcions/extres amb 'options_id' (IDs de list_product_options). El servidor valora preu, opcions i lliurament. " +
          "Abans de cridar-la, DEMANA el consentiment de l'usuari i les seves dades (nom, cognoms, email, telèfon amb prefix, país). " +
          "Usa els identificadors obtinguts de search_mobility_rentals. El servidor recalcula el preu (no l'enviïs tu). Segons el proveïdor, " +
          "l'usuari pot pagar un DIPÒSIT ara i la resta a la recollida: comunica-li el desglossament (pay_now / pay_at_pickup). Algunes " +
          "reserves queden pendents de confirmació. Si la resposta indica fallback (el proveïdor requereix el checkout complet), " +
          "usa en lloc d'això el 'booking_link' de search_mobility_rentals.",
        inputSchema: {
          id_product_store: z.number().describe("id_product_store del resultat de cerca. [prova Sevilla: 559]"),
          id_store: z.number().describe("id_store del resultat de cerca. [prova Sevilla: 76]"),
          id_virtual: z.number().describe("id_virtual del resultat de cerca (0 si botiga física). [prova: 0]"),
          start_date: DATE.describe("Data d'inici (YYYY-MM-DD). [prova: 2026-07-24]"),
          end_date: DATE.describe("Data de fi (YYYY-MM-DD). [prova: 2026-07-24]"),
          customer: z
            .object({
              first_name: z.string().describe("Nom. [prova: Test]"),
              last_name: z.string().describe("Cognoms. [prova: MCP]"),
              email: z.string().describe("Correu electrònic. [prova: test@motion4rent.com]"),
              phone: z.string().describe("Telèfon (sense prefix). [prova: 600000000]"),
              phone_prefix: z.string().optional().describe("Prefix internacional, p. ex. '+34'. [prova: +34]"),
              country: z.string().describe("Codi de país ISO alpha-2, p. ex. 'ES'. [prova: ES]"),
            })
            .describe("Dades del client (amb consentiment)"),
          language: z.string().optional().describe("Idioma (en, es, fr...). Per defecte 'en'. [prova: es]"),
          currency: z
            .string()
            .optional()
            .describe("Moneda de pagament (una de list_currencies, p. ex. 'USD'). Opcional; per defecte la del producte. El servidor valida i recalcula. [prova: USD]"),
          options_id: z
            .array(z.number())
            .optional()
            .describe("IDs d'opcions/extres a afegir (de list_product_options). El servidor en valora el preu. Opcional. [prova: [1710,1711]]"),
          delivery_type: z
            .number()
            .optional()
            .describe("Lliurament: 0 (o omès) recollida a botiga (gratis), 1 domicili, 2 hotel, 3 creuer (ciutat), 5 aeroport."),
          delivery_address: z
            .string()
            .optional()
            .describe("Adreça/punt de lliurament (per creuer: port/moll). OBLIGATÒRIA si delivery_type és 1, 2 o 3."),
          hotel_name: z
            .string()
            .optional()
            .describe("Nom de l'hotel (opcional, si delivery_type és 2)."),
          airport_place_id: z
            .string()
            .optional()
            .describe("place_id de l'aeroport (de get_rental_details.airports). OBLIGATORI si delivery_type és 5."),
          flight_number: z
            .string()
            .optional()
            .describe("Nº de vol. OBLIGATORI si delivery_type és 5."),
          newsletter: z.boolean().optional().describe("Consentiment de newsletter. Opcional."),
          comments: z.string().optional().describe("Comentaris per a la botiga. Opcional."),
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
              "Aquest proveïdor necessita el checkout complet de la web. Fes servir el 'booking_link' de search_mobility_rentals.",
              { created: false, fallback_deeplink: true },
            );
          }
          if (!r.ok) {
            return errResult(`No s'ha pogut crear la reserva (${r.status}): ${r.error ?? "error desconegut"}`);
          }

          return jsonResult(
            `Reserva creada (hold ${r.increment_id}). Enllaç de pagament: ${r.urlTpv}. ` +
              `L'usuari paga ${r.pay_now} ara` +
              (r.pay_at_pickup ? ` i ${r.pay_at_pickup} a la recollida a botiga` : "") +
              `. Presenta-li l'enllaç i el desglossament.`,
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
                "El pagament el completa l'usuari a payment_link. La reserva pot quedar pendent de confirmació del punt de recollida.",
            },
          );
        } catch (e) {
          return errResult(`Error creant la reserva: ${(e as Error).message}`);
        }
      },
    );
  }
}
