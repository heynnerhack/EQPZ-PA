import { readFile, writeFile } from "node:fs/promises";

const API_URL = "https://sismopanama.vercel.app/api/earthquakes";
const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const STATE_FILE = "state.json";

const formatPanama = (ms) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Panama",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};

const loadState = async () => {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch {
    return null; // primera ejecución
  }
};

const send = async (f) => {
  const p = f.properties;
  const content = [
    "**REPORTE AUTOMÁTICO**",
    `Magnitud: ${p.mag}`,
    `Hora Local (GMT-5): ${formatPanama(p.time)}`,
    `Ubicado en ${p.place}`,
    `Fuente: ${p.source}`,
    `ESTADO:${p.status}`,
  ].join("\n");
  const r = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!r.ok) throw new Error(`Discord respondió ${r.status}`);
};

const res = await fetch(API_URL, { signal: AbortSignal.timeout(30_000) });
if (!res.ok) throw new Error(`API respondió ${res.status}`);
const { features = [] } = await res.json();

if (features.length === 0) {
  console.log("La API no devolvió sismos; no se modifica el estado.");
  process.exit(0);
}

const state = await loadState();
const firstRun = state === null;
const seen = new Set(state?.seen ?? []);

const fresh = features.filter((f) => !seen.has(f.id)).reverse(); // más viejos primero
const done = new Set();
let error = null;

if (firstRun) {
  features.forEach((f) => done.add(f.id)); // solo marcar, no enviar
} else {
  for (const f of fresh) {
    try {
      await send(f);
      done.add(f.id);
    } catch (e) {
      error = e; // se reintenta en la siguiente ejecución
      break;
    }
  }
}

// Solo se guardan IDs que la API sigue devolviendo; lo que falló queda fuera y se reintenta
const keep = new Set([...seen, ...done]);
const updated = features.map((f) => f.id).filter((id) => keep.has(id));
await writeFile(STATE_FILE, JSON.stringify({ seen: updated }, null, 2));

if (error) throw error;
console.log(`Procesados: ${done.size}`);
