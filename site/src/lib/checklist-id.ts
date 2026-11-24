function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildShortSlugPrefix(normalizedText: string): string {
  const words = normalizedText
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  const joined = words.join('-').slice(0, 24).replace(/-+$/g, '');
  return joined || 'item';
}

/**
 * Generates a deterministic checklist item ID from checklist slug, section heading ID,
 * and normalized primary item text (never positional index).
 */
export function generateChecklistItemId(
  checklistSlug: string,
  headingId: string,
  itemText: string,
  seenCounts?: Map<string, number>,
): string {
  const normalizedText = itemText.replace(/\s+/g, ' ').trim();
  const normalizedHeading = headingId.trim() || 'root';
  const digest = fnv1a32Hex(`${checklistSlug}|${normalizedHeading}|${normalizedText}`);
  const prefix = buildShortSlugPrefix(normalizedText);
  const baseId = `chk-${prefix}-${digest}`;

  if (!seenCounts) {
    return baseId;
  }

  const nextCount = (seenCounts.get(baseId) ?? 0) + 1;
  seenCounts.set(baseId, nextCount);
  return nextCount === 1 ? baseId : `${baseId}-${nextCount}`;
}
