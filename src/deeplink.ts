/**
 * Construcció del deep-link a la pàgina de resultats de la web (on l'usuari
 * completa lliurament/opcions/pagament). Reprodueix el contracte d'URL de la web
 * (mateix mapa de slugs que webs/ia src/business/motion4rent/links.ts + la lògica
 * del sitemap): {locale_path}{slug_generico}{urlCiudad}?start&end&sh&eh&lat&lon&name&url[#typeProd:...]
 *
 * IMPORTANT: no crea cap comanda ni cobra res; només porta l'usuari a la web amb
 * la cerca pre-omplerta (opció E del pla — descoberta + handoff a pagar a la web).
 */

export type IdiomaSlug =
  | "en-US" | "es" | "de" | "fr" | "it" | "en-GB" | "pt-PT" | "pt-BR" | "nl" | "zh" | "ja";

interface SlugEntry {
  locale_path: string; // "" per a en-US (sense prefix)
  slug_generico: string;
}

/** Mapa fix locale_path + slug per idioma (contracte estable amb la web). */
export const SLUGS_POR_IDIOMA: Record<IdiomaSlug, SlugEntry> = {
  "en-US": { locale_path: "", slug_generico: "mobility-equipment-rental-in-" },
  es: { locale_path: "/es/", slug_generico: "alquiler-de-equipos-de-movilidad-en-" },
  de: { locale_path: "/de/", slug_generico: "vermietung-von-mobilitatsausrustung-in-" },
  fr: { locale_path: "/fr/", slug_generico: "location-d-equipements-de-mobilite-a-" },
  it: { locale_path: "/it/", slug_generico: "noleggio-attrezzature-per-la-mobilita-a-" },
  "en-GB": { locale_path: "/en-gb/", slug_generico: "mobility-equipment-hire-in-" },
  "pt-PT": { locale_path: "/pt/", slug_generico: "aluguer-de-equipamento-de-mobilidade-em-" },
  "pt-BR": { locale_path: "/pt-br/", slug_generico: "aluguel-de-equipamento-de-mobilidade-em-" },
  nl: { locale_path: "/nl/", slug_generico: "mobiliteitshulpmiddelen-verhuur-in-" },
  zh: { locale_path: "/zh/", slug_generico: "mobility-equipment-rental-in-" },
  ja: { locale_path: "/ja/", slug_generico: "mobility-equipment-rental-in-" },
};

/** Normalitza l'idioma a una clau del mapa (en→en-US, pt→pt-PT, desconegut→en-US). */
export function resolverIdioma(language: string): IdiomaSlug {
  const l = (language ?? "").trim().toLowerCase();
  switch (l) {
    case "en": case "en-us": return "en-US";
    case "en-gb": return "en-GB";
    case "pt": case "pt-pt": return "pt-PT";
    case "pt-br": return "pt-BR";
    case "es": case "de": case "fr": case "it": case "nl": case "zh": case "ja":
      return l as IdiomaSlug;
    default: return "en-US";
  }
}

/** Slug de ciutat: minúscules, sense accents, espais → guions (mateix criteri que l'API). */
export function slugCiudad(city: string): string {
  return (city ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
}

/** Espais → '+', reservats percent-encoded (mateix contracte que webs/ia per al hash). */
function encodeTypeProd(t: string): string {
  return encodeURIComponent(t.trim().toLowerCase()).replace(/%20/g, "+");
}

export interface BuildLinkArgs {
  language: string;
  /** Slug de ciutat ja traduït (url_{idioma}); si no, es derivarà del nom. */
  urlCiudad: string;
  inicio: string; // YYYY-MM-DD
  final: string; // YYYY-MM-DD
  sh?: string; // HHMM
  eh?: string; // HHMM
  /** Coordenades (de la geocodificació): la web resol tiendes físiques per distància. */
  lat?: string;
  lon?: string;
  /** Nom de ciutat per mostrar. */
  name?: string;
  /** Noms de tipus de producte per al filtre #typeProd (buit = sense filtre). */
  types?: string[];
}

export function buildResultsLink(base: string, args: BuildLinkArgs): string {
  const { locale_path, slug_generico } = SLUGS_POR_IDIOMA[resolverIdioma(args.language)];
  const ciudad = (args.urlCiudad ?? "").trim();
  const raw = `${locale_path}${slug_generico}${ciudad}`;
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  const sh = args.sh && /^\d{3,4}$/.test(args.sh) ? args.sh : "1000";
  const eh = args.eh && /^\d{3,4}$/.test(args.eh) ? args.eh : "1000";

  let query = `start=${encodeURIComponent(args.inicio)}&end=${encodeURIComponent(args.final)}&sh=${sh}&eh=${eh}`;

  const lat = (args.lat ?? "").trim();
  const lon = (args.lon ?? "").trim();
  if (lat && lon) {
    query += `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const name = (args.name ?? "").trim();
    if (name) query += `&name=${encodeURIComponent(name)}`;
    if (ciudad) query += `&url=${encodeURIComponent(ciudad)}`;
  }

  let url = `${base}${path}?${query}`;
  const tipos = (args.types ?? []).filter((t) => typeof t === "string" && t.trim());
  if (tipos.length) {
    url += `#${tipos.map((t) => `typeProd:${encodeTypeProd(t)}`).join("&")}`;
  }
  return url;
}
