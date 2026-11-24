/* ReelKeep item handler registry — the core never branches on type outside
   handlers and this registry. Adding a type = new handler file + register(). */

const handlers = new Map();

export function registerHandler(handler) {
  handlers.set(handler.type, handler);
}

export const getHandler = (type) => handlers.get(type);
export const allHandlers = () => [...handlers.values()];

/** Highest-confidence handler for pasted/dropped input; link is the fallback. */
export function detectType(input) {
  let best = { type: 'link', score: 0 };
  for (const h of handlers.values()) {
    const score = h.detect(input) || 0;
    if (score > best.score) best = { type: h.type, score };
  }
  return best.type;
}

export const labelOf = (item, t = globalThis.t) => getHandler(item.type)?.label(item, t) ?? item.source?.name ?? '';
export const iconOf = (item) => getHandler(item.type)?.icon ?? '#i-link';
export const sourceKeyOf = (item) => getHandler(item.type)?.sourceKey?.(item) ?? item.type;
export const stampOf = (item, t = globalThis.t) => getHandler(item.type)?.stamp?.(item, t) ?? '';
export const playsOf = (item) => !!getHandler(item.type)?.plays;
export const coversOf = (item) => getHandler(item.type)?.covers !== false;
export const badgeOf = (item) =>
  getHandler(item.type)?.badge?.(item) ?? `<svg class="ticon"><use href="${getHandler(item.type)?.icon ?? '#i-link'}" /></svg>`;
