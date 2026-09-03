/**
 * Identity every frontend fixture must carry.
 *
 * A capture, a test, a log line or a reader must be able to tell a
 * demonstration from a workspace without trusting a caption. So each fixture
 * declares three things about itself — that it is synthetic, which revision of
 * the declared inputs it is, and a hash of those inputs — and the surfaces that
 * render it repeat the first fact in visible text.
 *
 * The hash covers the *declared inputs only*. Everything downstream is produced
 * by the product's own engines, so hashing the derived output would just hash
 * the engines a second time. If an input moves, the hash moves, and stale
 * evidence stops matching the tree that produced it.
 */

export type SyntheticFixtureIdentity = {
  readonly synthetic: true;
  readonly fixtureId: string;
  readonly version: string;
  readonly sourceHash: string;
};

/** Visible on every surface that renders a fixture. Never softened. */
export const SYNTHETIC_DEMO_LABEL = "Synthetic demonstration";

/**
 * One namespace for every synthetic id, so a demonstration record is
 * recognisable on sight and can never collide with a real workspace id.
 */
export const SYNTHETIC_DEMO_UUID_NAMESPACE = "5eeded00-0000-4000-8000-";

export const syntheticId = (suffix: string) => `${SYNTHETIC_DEMO_UUID_NAMESPACE}${suffix}`;

/**
 * FNV-1a over the canonical JSON of the declared inputs. Deterministic, pure,
 * dependency-free, and identical in a Server Component, a Client Component and
 * a Node test — which `node:crypto` would not be.
 */
export function fixtureSourceHash(inputs: unknown): string {
  const text = JSON.stringify(inputs, Object.keys(flatten(inputs)).sort());
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function syntheticFixtureIdentity(
  fixtureId: string,
  version: string,
  inputs: unknown,
): SyntheticFixtureIdentity {
  return { synthetic: true, fixtureId, version, sourceHash: fixtureSourceHash(inputs) };
}

/** Key discovery for stable JSON key ordering; values are never read here. */
function flatten(value: unknown, into: Record<string, true> = {}, depth = 0): Record<string, true> {
  if (depth > 12 || value === null || typeof value !== "object") return into;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    into[key] = true;
    flatten(nested, into, depth + 1);
  }
  return into;
}
