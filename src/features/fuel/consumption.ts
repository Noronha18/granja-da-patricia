export type FuelEvent = {
  id: string;
  occurredAt: string;
  odometerKm: number;
  litres: number;
  totalCents: number;
  fuelType: string;
  fullTank: boolean;
  reversed: boolean;
};

type TimedEvent = { event: FuelEvent; time: number };

function validateEvent(event: FuelEvent): TimedEvent {
  const time = Date.parse(event.occurredAt);
  if (!Number.isFinite(time) ||
      !Number.isSafeInteger(event.odometerKm) || event.odometerKm < 0 ||
      !Number.isFinite(event.litres) || event.litres <= 0 ||
      !Number.isSafeInteger(event.totalCents) || event.totalCents < 0 ||
      typeof event.fuelType !== "string" || !event.fuelType.trim() ||
      typeof event.fullTank !== "boolean") {
    throw new RangeError("Invalid fuel event");
  }
  return { event: { ...event, fuelType: event.fuelType.trim() }, time };
}

export function measureConsumption(events: FuelEvent[]): {
  kmPerLitre: number;
  from: string;
  to: string;
  fuelType: string;
} | null {
  const ordered: TimedEvent[] = [];
  for (const event of events) {
    if (typeof event.reversed !== "boolean") throw new RangeError("Invalid fuel event reversal");
    if (!event.reversed) ordered.push(validateEvent(event));
  }
  ordered.sort((a, b) => a.time - b.time);

  const fullTanks = ordered.flatMap((item, index) => item.event.fullTank ? [index] : []);
  for (let i = fullTanks.length - 1; i > 0; i--) {
    const start = fullTanks[i - 1];
    const end = fullTanks[i];
    const startEvent = ordered[start].event;
    const endEvent = ordered[end].event;
    const startTime = ordered[start].time;
    const endTime = ordered[end].time;
    const interval = ordered.filter(item => item.time >= startTime && item.time <= endTime);
    const intervalTimes = new Set<number>();
    let ambiguousTime = false;
    for (const item of interval) {
      if (intervalTimes.has(item.time)) ambiguousTime = true;
      intervalTimes.add(item.time);
    }
    if (ambiguousTime) continue;

    const fuelType = startEvent.fuelType;
    if (interval.some(item => item.event.fuelType !== fuelType)) continue;
    if (interval.some((item, index) =>
      index > 0 && item.event.odometerKm < interval[index - 1].event.odometerKm)) continue;

    const distance = endEvent.odometerKm - startEvent.odometerKm;
    if (distance <= 0) continue;
    const litres = interval
      .filter(item => item !== ordered[start])
      .reduce((sum, item) => sum + item.event.litres, 0);
    if (!Number.isFinite(litres) || litres <= 0) continue;
    const kmPerLitre = distance / litres;
    if (!Number.isFinite(kmPerLitre) || kmPerLitre <= 0) continue;

    return {
      kmPerLitre,
      from: startEvent.occurredAt,
      to: endEvent.occurredAt,
      fuelType,
    };
  }
  return null;
}

export function estimateRouteFuel(
  km: number,
  kmPerLitre: number | null,
  priceCentsPerLitre: number | null,
): { litres: number; costCents: number } | null {
  if (!Number.isFinite(km) || km < 0 ||
      (kmPerLitre !== null && (!Number.isFinite(kmPerLitre) || kmPerLitre <= 0)) ||
      (priceCentsPerLitre !== null &&
        (!Number.isFinite(priceCentsPerLitre) || priceCentsPerLitre < 0))) {
    throw new RangeError("Invalid fuel estimate input");
  }
  if (kmPerLitre === null || priceCentsPerLitre === null) return null;

  const litres = km / kmPerLitre;
  const costCents = Math.round(litres * priceCentsPerLitre);
  if (!Number.isFinite(litres) || !Number.isSafeInteger(costCents)) {
    throw new RangeError("Fuel estimate exceeds safe range");
  }
  return { litres, costCents };
}
