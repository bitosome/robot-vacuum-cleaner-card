/** The visible order owns the sequence; toggles only control membership. */
export function reconcileOrder(preferred: readonly string[], available: readonly string[]): string[] {
  const valid = new Set(available);
  return [...new Set([...preferred.filter(id => valid.has(id)), ...available])];
}

export function moveRoom(order: readonly string[], id: string, index: number): string[] {
  if (!order.includes(id)) return [...order];
  const next = order.filter(value => value !== id);
  next.splice(Math.max(0, Math.min(index, next.length)), 0, id);
  return next;
}
