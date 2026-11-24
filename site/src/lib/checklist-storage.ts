import {
  BUILD_CHECKLISTS_CATALOG,
  TOTAL_CHECKLIST_ITEMS,
  type ChecklistSlug,
} from '../data/build-checklists.ts';

/** Versioned localStorage key prefix for checklist progress state. */
export const CHECKLIST_STORAGE_PREFIX = 'envskew:checklist:v1:';
export const CHECKLIST_STORAGE_VERSION = 1;

/** Persisted per-checklist JSON envelope. */
export interface PersistedChecklistPayload {
  version: number;
  checked: string[];
  updatedAt?: string;
}

/** Per-step progress metrics. */
export interface ChecklistStepProgress {
  slug: ChecklistSlug;
  done: number;
  total: number;
  percent: number;
}

/** Aggregate progress summary across all 6 checklists (211 items total). */
export interface AllChecklistsProgressSummary {
  steps: ChecklistStepProgress[];
  totalDone: number;
  totalItems: number;
  percent: number;
}

function resolveDefaultStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Private browsing or blocked storage access
  }
  return null;
}

/** Returns the versioned localStorage key for a given checklist slug. */
export function getChecklistStorageKey(slug: ChecklistSlug): string {
  return `${CHECKLIST_STORAGE_PREFIX}${slug}`;
}

/** Loads saved item IDs for a checklist, recovering gracefully from corrupt or legacy payloads. */
export function loadCheckedItemIds(
  slug: ChecklistSlug,
  storage: Storage | null = resolveDefaultStorage(),
): Set<string> {
  if (!storage) {
    return new Set();
  }
  try {
    const raw = storage.getItem(getChecklistStorageKey(slug));
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw) as Partial<PersistedChecklistPayload> | null;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed.version !== CHECKLIST_STORAGE_VERSION ||
      !Array.isArray(parsed.checked)
    ) {
      return new Set();
    }
    const ids = parsed.checked.filter(
      (entry): entry is string => typeof entry === 'string' && entry.length > 0,
    );
    return new Set(ids);
  } catch {
    return new Set();
  }
}

/** Persists deduplicated checked item IDs to storage. Returns false if storage is unavailable/full. */
export function saveCheckedItemIds(
  slug: ChecklistSlug,
  ids: Iterable<string>,
  storage: Storage | null = resolveDefaultStorage(),
): boolean {
  if (!storage) {
    return false;
  }
  const uniqueIds = [...new Set(ids)].filter((id) => typeof id === 'string' && id.length > 0).sort();
  try {
    if (uniqueIds.length === 0) {
      storage.removeItem(getChecklistStorageKey(slug));
      return true;
    }
    const payload: PersistedChecklistPayload = {
      version: CHECKLIST_STORAGE_VERSION,
      checked: uniqueIds,
      updatedAt: new Date().toISOString(),
    };
    storage.setItem(getChecklistStorageKey(slug), JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/** Clears saved state for a single checklist step. */
export function clearChecklistProgress(
  slug: ChecklistSlug,
  storage: Storage | null = resolveDefaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(getChecklistStorageKey(slug));
  } catch {
    // Ignore storage removal errors
  }
}

/** Clears saved state across multiple checklist steps. */
export function clearAllChecklistProgress(
  slugs: readonly ChecklistSlug[],
  storage: Storage | null = resolveDefaultStorage(),
): void {
  for (const slug of slugs) {
    clearChecklistProgress(slug, storage);
  }
}

/** Computes progress percentage and clamped count for one step. */
export function computeChecklistProgress(
  slug: ChecklistSlug,
  totalItems: number,
  storage: Storage | null = resolveDefaultStorage(),
): ChecklistStepProgress {
  const checked = loadCheckedItemIds(slug, storage);
  const done = Math.min(checked.size, Math.max(0, totalItems));
  const percent = totalItems > 0 ? Math.round((done / totalItems) * 100) : 0;
  return { slug, done, total: totalItems, percent };
}

/** Computes aggregate X / 211 build completion across all 6 phases. */
export function computeAllChecklistsProgress(
  storage: Storage | null = resolveDefaultStorage(),
): AllChecklistsProgressSummary {
  const steps = BUILD_CHECKLISTS_CATALOG.map((meta) =>
    computeChecklistProgress(meta.slug, meta.totalItems, storage),
  );
  const totalDone = steps.reduce((sum, step) => sum + step.done, 0);
  const percent = TOTAL_CHECKLIST_ITEMS > 0 ? Math.round((totalDone / TOTAL_CHECKLIST_ITEMS) * 100) : 0;
  return {
    steps,
    totalDone,
    totalItems: TOTAL_CHECKLIST_ITEMS,
    percent,
  };
}
