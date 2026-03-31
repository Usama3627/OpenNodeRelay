/**
 * Simple RFC 4122 v4 UUID generator.
 * Avoids ESM-only uuid package compatibility issues with Metro.
 */
export function generateId() {
  // Use Math.random — sufficient for request correlation IDs (not security)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
