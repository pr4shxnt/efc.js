// pg-boss accepts object payloads. Escape user objects that contain the legacy
// box key, and retain support for jobs written by older EFC versions.
const VALUE = '__efcValue';
const VERSION = '__efcBox';
export function boxPgPayload(payload: unknown): object {
  if (payload === undefined) return {}; // Same JSON-queue normalization as BullMQ.
  if (
    payload !== null &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    !Object.hasOwn(payload, VALUE)
  )
    return payload;
  return { [VERSION]: 1, [VALUE]: payload };
}
export function unboxPgPayload(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || !Object.hasOwn(data, VALUE)) return data;
  const keys = Object.keys(data);
  if (
    keys.length === 1 ||
    (keys.length === 2 &&
      Object.hasOwn(data, VERSION) &&
      (data as Record<string, unknown>)[VERSION] === 1)
  )
    return (data as Record<string, unknown>)[VALUE];
  return data;
}
