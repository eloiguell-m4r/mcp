/**
 * Dataset curat de polítiques/FAQ de Motion4Rent per a la tool `mobility_policies`.
 *
 * FONT: rèplica del corpus RAG canònic de webs/ia (knowledge/chunks.motion4rent.es.json).
 * El `text` és el contingut original en ESPANYOL (font de veritat); `title`/`keywords`
 * en anglès són per al matching. El client (Claude/ChatGPT) tradueix a l'idioma de l'usuari.
 *
 * MANTENIMENT: si canvia el corpus a webs/ia, actualitza aquest fitxer també.
 * (Futur: centralitzar via un endpoint /ai/faq a motion4rent-api per no duplicar.)
 */

export interface Policy {
  id: string;
  topic: string; // categoria (per filtrar)
  title: string; // etiqueta EN (matching + presentació)
  keywords: string[]; // EN + ES (matching)
  text: string; // contingut ES (font de veritat)
}

export const POLICIES: Policy[] = [
  {
    id: "cancellation",
    topic: "cancellation",
    title: "Cancellation policy",
    keywords: ["cancel", "cancellation", "refund", "cancelar", "cancelación", "reembolso", "anular"],
    text: "La cancelación de una reserva es gratuita si se solicita con al menos 48 horas de antelación al inicio del alquiler, con reembolso íntegro. Entre 48 y 24 horas antes del inicio se retiene el importe equivalente a un día de alquiler. Con menos de 24 horas de antelación, o si el cliente no se presenta, no se realiza reembolso.",
  },
  {
    id: "deposit",
    topic: "deposit",
    title: "Deposit / security hold",
    keywords: ["deposit", "security deposit", "hold", "fianza", "depósito", "garantía", "preautorización", "card"],
    text: "Al recoger o recibir el equipo se solicita una fianza reembolsable mediante preautorización en tarjeta. El importe depende del tipo de equipo: es menor para un andador y mayor para un scooter de movilidad o una silla de ruedas eléctrica. La fianza se libera tras la devolución del equipo en buen estado; la preautorización puede tardar unos días en desaparecer del extracto según el banco.",
  },
  {
    id: "delivery_process",
    topic: "delivery",
    title: "Delivery — how it works",
    keywords: ["delivery", "deliver", "how it works", "hotel", "airport", "entrega", "domicilio", "aeropuerto"],
    text: "Motion4Rent entrega el equipo en la dirección que indique el cliente: domicilio, hotel, apartamento o aeropuerto. La entrega se coordina por teléfono o WhatsApp el día anterior para acordar una franja horaria, y el equipo se entrega montado y listo para usar.",
  },
  {
    id: "delivery_coverage",
    topic: "delivery",
    title: "Delivery coverage & cost",
    keywords: ["delivery cost", "coverage", "area", "surcharge", "coste", "cobertura", "área urbana", "suplemento", "fuera de zona", "otra localidad"],
    text: "La entrega solo existe si hay una tienda (física o virtual) que da servicio a esa localidad; son las opciones de entrega que aparecen al buscar. La simple cercanía a una ciudad con tienda NO implica que se pueda entregar en el pueblo o dirección de al lado. Si al buscar una localidad no aparece ninguna opción de entrega (no hay tienda para esa zona), Motion4rent NO puede entregar allí a través de este asistente, aunque haya una ciudad cubierta cerca: NO se debe ofrecer ni preparar una reserva para 'comprobar' la cobertura. En ese caso hay que remitir a la persona a contactar con Motion4rent (formulario de contacto, email, teléfono o WhatsApp) para confirmar si es posible una entrega especial.",
  },
  {
    id: "contact",
    topic: "contact",
    title: "Contact Motion4Rent",
    keywords: ["contact", "help", "phone", "whatsapp", "email", "form", "support", "contacto", "contacte", "ayuda", "teléfono", "correo", "formulario", "atención"],
    text: "Puedes contactar con Motion4rent por cualquiera de estos canales (ofrécelos TODOS): formulario de contacto https://www.motion4rent.com/contact ; correo electrónico info@motion4rent.com ; teléfono de llamadas +34 932 20 15 13 ; WhatsApp +34 931 66 70 77 (https://wa.me/34931667077). Importante: el teléfono de llamadas y el de WhatsApp son NÚMEROS DISTINTOS. El equipo confirma disponibilidad, coberturas de entrega fuera de la zona habitual y ayuda con las reservas.",
  },
  {
    id: "folding",
    topic: "product",
    title: "Folding / dismountable equipment",
    keywords: ["fold", "foldable", "folds", "trunk", "car", "plegable", "plegar", "maletero", "desmontable"],
    text: "Algunos scooters de movilidad son plegables y se pliegan en pocos segundos, de modo que caben en el maletero de la mayoría de turismos. No todos los modelos son plegables: los de mayor autonomía suelen ser desmontables en piezas (asiento, batería y chasis) en lugar de plegarse en bloque.",
  },
  {
    id: "weight_capacity",
    topic: "product",
    title: "Maximum weight capacity",
    keywords: ["weight", "capacity", "max weight", "kg", "supports", "peso máximo", "capacidad", "carga"],
    text: "El peso máximo que soporta cada equipo depende del modelo. Los scooters de movilidad estándar admiten habitualmente hasta unos 120 kg, y los modelos reforzados llegan a unos 160 kg. Las sillas de ruedas eléctricas suelen admitir hasta unos 120 kg. Para el peso exacto conviene consultar la ficha del modelo concreto.",
  },
  {
    id: "portability",
    topic: "product",
    title: "Public transport & flights",
    keywords: ["public transport", "plane", "flight", "train", "bus", "battery", "lithium", "transporte público", "avión", "tren", "batería"],
    text: "Los scooters de movilidad plegables pueden llevarse en transporte público y también en avión. Para vuelos, la mayoría de aerolíneas exige que la batería sea de litio y no supere un límite de vatios-hora; se recomienda avisar a la aerolínea con antelación y llevar la documentación de la batería. En autobús y tren se admiten plegados y, en algunos casos, montados si hay espacio reservado para movilidad.",
  },
  {
    id: "insurance_basic",
    topic: "insurance",
    title: "Basic insurance coverage",
    keywords: ["insurance", "coverage", "breakdown", "damage", "excess", "theft", "seguro", "avería", "daños", "franquicia", "robo"],
    text: "Todos los alquileres incluyen un seguro básico que cubre las averías por uso normal y la asistencia para sustituir el equipo si deja de funcionar. No cubre los daños por mal uso o negligencia, ni el robo sin denuncia policial. El cliente puede contratar una cobertura ampliada que reduce o elimina la franquicia en caso de daño.",
  },
  {
    id: "returns",
    topic: "returns",
    title: "Returning the equipment",
    keywords: ["return", "drop off", "pickup", "where to return", "end of rental", "devolución", "devolver", "recogida"],
    text: "El equipo se devuelve en el mismo modo acordado para la entrega: nuestro equipo lo recoge en la dirección indicada, o bien el cliente lo entrega en una de nuestras tiendas. La recogida se coordina para el último día del periodo de alquiler; si el cliente necesita devolverlo antes o después, debe avisar para reprogramarla.",
  },
  {
    id: "cities",
    topic: "coverage",
    title: "Cities / countries of operation",
    keywords: ["cities", "where do you operate", "service area", "countries", "availability", "ciudades", "países", "zona"],
    text: "Motion4Rent opera en numerosas ciudades de España y de otros países. Que un equipo concreto esté disponible y que haya servicio para una ciudad y unas fechas determinadas depende del stock y de la zona, y se confirma al hacer la reserva.",
  },
  {
    id: "liability",
    topic: "insurance",
    title: "Civil liability",
    keywords: ["liability", "civil liability", "responsabilidad civil", "seguros"],
    text: "Motion4rent no cubre la responsabilidad civil del cliente. Es responsabilidad del cliente contratar un seguro de responsabilidad civil propio.",
  },
];

/** Filtra polítiques per una consulta (tokens sobre title/keywords/text). Sense query → totes. */
export function findPolicies(query?: string): Policy[] {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return POLICIES;
  const tokens = q.split(/\s+/).filter((t) => t.length >= 3);
  if (!tokens.length) return POLICIES;
  const scored = POLICIES.map((p) => {
    const hay = (p.title + " " + p.keywords.join(" ") + " " + p.text).toLowerCase();
    const score = tokens.reduce((s, t) => (hay.includes(t) ? s + 1 : s), 0);
    return { p, score };
  }).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  // Si no hi ha cap match, retorna totes (millor context que res).
  return scored.length ? scored.map((x) => x.p) : POLICIES;
}
