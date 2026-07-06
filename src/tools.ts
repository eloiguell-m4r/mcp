/**
 * Tools MCP de Motion4Rent (read-only). El "cervell" conversacional és el client
 * (Claude/ChatGPT); aquestes tools són fines i criden l'API pública + construeixen
 * el deep-link a la web. NO creen comandes ni cobren (opció E del pla).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "./config.js";
import { buildResultsLink, slugCiudad } from "./deeplink.js";
import { apiLocale, geocodeCity, searchResults, getDetails, createBooking } from "./m4rApi.js";
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
      },
    },
    async ({ city, start_date, end_date, product_type, country, language }) => {
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
        const truncated = search.productos.length > MAX_PRODUCTS;
        const summary =
          search.number > 0
            ? `Hi ha ${search.number} opció(ns) a ${name} (${start_date} → ${end_date}). ` +
              `Mostro ${productos.length}${truncated ? " (retallat)" : ""}. Enllaç per reservar: ${bookingLink}`
            : `Sense disponibilitat a ${name} per a aquestes dates. Enllaç per revisar/altres dates: ${bookingLink}`;

        return jsonResult(summary, {
          city: name,
          country: place.country,
          dates: { start: start_date, end: end_date },
          available: search.number > 0,
          count: search.number,
          products: productos,
          product_types_available: search.typesProducts,
          booking_link: bookingLink,
          note: "El pagament i el lliurament es completen a la web (booking_link). Aquesta tool no crea comandes.",
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
        "Retorna el detall d'un producte concret (specs, preu, extres, política de cancel·lació) a partir dels " +
        "identificadors obtinguts de search_mobility_rentals.",
      inputSchema: {
        id_product_store: z.number().describe("id_product_store del resultat de cerca"),
        id_store: z.number().describe("id_store del resultat de cerca"),
        id_virtual: z.number().describe("id_virtual del resultat de cerca (0 si botiga física)"),
        start_date: DATE.describe("Data d'inici (YYYY-MM-DD)"),
        end_date: DATE.describe("Data de fi (YYYY-MM-DD)"),
        language: z.string().optional().describe("Idioma (en, es, fr...). Per defecte 'en'."),
      },
    },
    async ({ id_product_store, id_store, id_virtual, start_date, end_date, language }) => {
      try {
        const detail = await getDetails(config.apiBaseUrl, {
          idProductStore: id_product_store,
          idStore: id_store,
          idVirtual: id_virtual,
          start: start_date,
          end: end_date,
          locale: apiLocale(language ?? "en"),
        });
        if (!detail) {
          return jsonResult("No s'ha trobat el detall d'aquest producte per a aquestes dates.", {
            found: false,
            id_product_store,
          });
        }
        return jsonResult(`Detall de "${detail.name ?? "producte"}".`, detail);
      } catch (e) {
        return errResult(`Error obtenint el detall: ${(e as Error).message}`);
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
        "Retorna els textos oficials (en espanyol; tradueix-los a l'idioma de l'usuari). Passa 'query' per filtrar; sense query, torna tot.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Pregunta o paraules clau (p. ex. 'cancelación', 'deposit', 'delivery to hotel'). Opcional."),
      },
    },
    async ({ query }) => {
      const policies = findPolicies(query);
      const summary = query
        ? `${policies.length} política(es) rellevant(s) per a "${query}". Textos oficials en espanyol; tradueix a l'idioma del client.`
        : `Totes les polítiques (${policies.length}). Textos oficials en espanyol; tradueix a l'idioma del client.`;
      return jsonResult(
        summary,
        policies.map((p) => ({ topic: p.topic, title: p.title, text: p.text })),
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
          "IMPORTANT: només per a RECOLLIDA A BOTIGA i SENSE extres/opcions. Abans de cridar-la, DEMANA el consentiment " +
          "de l'usuari i les seves dades (nom, cognoms, email, telèfon amb prefix, país). Usa els identificadors obtinguts " +
          "de search_mobility_rentals. El servidor recalcula el preu (no l'enviïs tu). Segons el proveïdor, l'usuari pot pagar " +
          "un DIPÒSIT ara i la resta a la recollida: comunica-li el desglossament (pay_now / pay_at_pickup). Algunes reserves " +
          "queden pendents de confirmació del punt de recollida. Si la resposta indica fallback (el proveïdor requereix el " +
          "checkout complet) o si l'usuari vol lliurament/extres, usa en lloc d'això el 'booking_link' de search_mobility_rentals.",
        inputSchema: {
          id_product_store: z.number().describe("id_product_store del resultat de cerca"),
          id_store: z.number().describe("id_store del resultat de cerca"),
          id_virtual: z.number().describe("id_virtual del resultat de cerca (0 si botiga física)"),
          start_date: DATE.describe("Data d'inici (YYYY-MM-DD)"),
          end_date: DATE.describe("Data de fi (YYYY-MM-DD)"),
          customer: z
            .object({
              first_name: z.string().describe("Nom"),
              last_name: z.string().describe("Cognoms"),
              email: z.string().describe("Correu electrònic"),
              phone: z.string().describe("Telèfon (sense prefix)"),
              phone_prefix: z.string().optional().describe("Prefix internacional, p. ex. '+34'"),
              country: z.string().describe("Codi de país ISO alpha-2, p. ex. 'ES'"),
            })
            .describe("Dades del client (amb consentiment)"),
          language: z.string().optional().describe("Idioma (en, es, fr...). Per defecte 'en'."),
          newsletter: z.boolean().optional().describe("Consentiment de newsletter. Opcional."),
          comments: z.string().optional().describe("Comentaris per a la botiga. Opcional."),
        },
      },
      async ({ id_product_store, id_store, id_virtual, start_date, end_date, customer, language, newsletter, comments }) => {
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
