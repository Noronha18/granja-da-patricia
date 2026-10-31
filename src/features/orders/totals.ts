import type { OrderItem } from "./types";

export function calculateTotals(items: OrderItem[]): { eggs: number; totalCents: number } {
  let eggs = 0;
  let totalCents = 0;

  for (const item of items) {
    if (!Number.isSafeInteger(item.eggsPerTray) || item.eggsPerTray <= 0 ||
        !Number.isSafeInteger(item.trays) || item.trays <= 0 ||
        !Number.isSafeInteger(item.priceCents) || item.priceCents < 0) {
      throw new RangeError("Invalid order item quantity or price");
    }

    const itemEggs = item.eggsPerTray * item.trays;
    const itemCents = item.priceCents * item.trays;
    if (!Number.isSafeInteger(itemEggs) || !Number.isSafeInteger(itemCents)) {
      throw new RangeError("Order item total exceeds safe integer range");
    }

    eggs += itemEggs;
    totalCents += itemCents;
    if (!Number.isSafeInteger(eggs) || !Number.isSafeInteger(totalCents)) {
      throw new RangeError("Order total exceeds safe integer range");
    }
  }

  return { eggs, totalCents };
}
