// P1-06: ProfileRepository — StoredField tri-state profiles in OUR namespace
// (DESIGN-v2 §10; a.md §3.B). Backs onto a plain object face that the Host
// wires to the plugin's own settings ns; fixtures drive it in tests.

import { modelKeyStorageKey, canonicalJson, digest } from "./domain.js";

export function createProfileRepository({ profiles = [], version = 1 } = {}) {
  const store = new Map();
  for (const record of profiles) store.set(record.storageKey, record);
  let profileVersion = version;

  return {
    /** Current desiredProfileVersion — bumps on every mutation (B5 §2.3). */
    get version() {
      return profileVersion;
    },

    /** Normalize a ModelKey + tri-state fields into a record (percent-escaped key). */
    buildRecord(key, fields, { lockedFields = [] } = {}) {
      const storageKey = modelKeyStorageKey(key);
      return {
        storageKey,
        key: { ...key },
        // tri-state per field: {state:"value"|"inherit"|"cleared", value?, origin?}
        fields: {
          contextWindow: normalizeField(fields.contextWindow),
          outputBudget: normalizeField(fields.outputBudget),
          input: normalizeField(fields.input),
          reasoning: normalizeField(fields.reasoning),
        },
        lockedFields: [...lockedFields],
        updatedAt: new Date().toISOString(),
      };
    },

    get(storageKey) {
      return store.get(storageKey);
    },

    /** Save (insert or update). Bumps version; same content = same fingerprint. */
    save(record) {
      const existing = store.get(record.storageKey);
      const next = { ...record, updatedAt: new Date().toISOString() };
      // Desired-version guard (B5 §2.3): a write must carry the version it
      // was based on; anything older than the stored record is stale and
      // refused — newer desired states are never clobbered by replayed writes.
      if (existing && existing._version !== undefined) {
        const incoming = record._version ?? existing._version;
        if (incoming < existing._version) {
          return { ok: false, error: "stale-write", currentVersion: existing._version };
        }
      }
      profileVersion += 1;
      store.set(record.storageKey, { ...next, _version: profileVersion });
      return { ok: true, revision: profileVersion, fingerprint: digest(canonicalJson(next.fields)) };
    },

    /** Clear one field → state:"cleared", locked:true (never autofills again). */
    clearField(storageKey, fieldId) {
      const record = store.get(storageKey);
      if (!record) return { ok: false, error: "not-found" };
      record.fields[fieldId] = { state: "cleared", locked: true };
      record.updatedAt = new Date().toISOString();
      profileVersion += 1;
      record._version = profileVersion;
      return { ok: true, revision: profileVersion };
    },

    /** Reset a cleared field back to inherit (user unlock action). */
    resetField(storageKey, fieldId) {
      const record = store.get(storageKey);
      if (!record) return { ok: false, error: "not-found" };
      record.fields[fieldId] = { state: "inherit" };
      profileVersion += 1;
      record._version = profileVersion;
      return { ok: true, revision: profileVersion };
    },

    /** Reopen semantics (P0-3 / a.md §5): cleared stays cleared after round-trip. */
    roundTrip(storageKey) {
      const record = store.get(storageKey);
      if (!record) return undefined;
      // serialize/deserialize the way the settings ns would (plain JSON)
      const serialized = JSON.parse(JSON.stringify({ ...record, _version: undefined }));
      return serialized;
    },

    /** Same storageKey on another route stays isolated (key includes route). */
    keys() {
      return [...store.keys()];
    },
  };
}

function normalizeField(field) {
  if (field === undefined || field === null) return { state: "inherit" };
  if (typeof field === "string") return { state: field };
  return field; // {state:"value", value, origin} etc.
}
