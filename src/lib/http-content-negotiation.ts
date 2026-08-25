const representations = ["text/html", "text/markdown"] as const;

export type Representation = (typeof representations)[number];

type AcceptEntry = {
  type: string;
  quality: number;
  specificity: number;
  position: number;
};

function parseAccept(header: string): AcceptEntry[] {
  return header
    .split(",")
    .flatMap((raw, position) => {
      const [rawType = "", ...rawParameters] = raw.trim().split(";");
      const type = rawType.trim().toLowerCase();
      if (!type) return [];
      let quality = 1;
      let qualitySeen = false;

      for (const rawParameter of rawParameters) {
        const [rawName = "", rawValue = ""] = rawParameter.split("=", 2);
        if (rawName.trim().toLowerCase() !== "q") continue;
        const value = rawValue.trim();
        if (qualitySeen || !/^(?:0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?)$/.test(value)) return [];
        qualitySeen = true;
        quality = Number(value);
      }

      return [{
        type,
        quality,
        specificity: type === "*/*" ? 0 : type.endsWith("/*") ? 1 : 2,
        position,
      }];
    });
}

function matches(entry: AcceptEntry, candidate: Representation): boolean {
  if (entry.type === "*/*") return true;
  if (entry.type.endsWith("/*")) return candidate.startsWith(entry.type.slice(0, -1));
  return entry.type === candidate;
}

export function preferredRepresentation(header: string | null): Representation | null {
  if (!header) return representations[0];
  const entries = parseAccept(header);
  if (entries.length === 0) return null;

  let bestType: Representation | null = null;
  let bestQuality = -1;
  let bestPosition = Number.POSITIVE_INFINITY;

  for (const candidate of representations) {
    let match: AcceptEntry | null = null;

    for (const entry of entries) {
      if (!matches(entry, candidate)) continue;
      if (match === null
        || entry.specificity > match.specificity
        || (entry.specificity === match.specificity && entry.position < match.position)) {
        match = entry;
      }
    }

    if (match === null || match.quality <= 0) continue;
    if (match.quality > bestQuality
      || (match.quality === bestQuality && match.position < bestPosition)) {
      bestType = candidate;
      bestQuality = match.quality;
      bestPosition = match.position;
    }
  }

  return bestType;
}