import { describe, expect, it } from "vitest";
import { calculateTotals } from "./totals";
import type { OrderItem } from "./types";

describe("calculateTotals", () => {
  it("calcula ovos e preço para várias bandejas", () => {
    expect(calculateTotals([
      { productId: "ovo", eggsPerTray: 30, trays: 6, priceCents: 3000 },
    ])).toEqual({ eggs: 180, totalCents: 18000 });
  });

  it("soma itens com quantidades e preços diferentes", () => {
    expect(calculateTotals([
      { productId: "15", eggsPerTray: 15, trays: 1, priceCents: 1700 },
      { productId: "20", eggsPerTray: 20, trays: 1, priceCents: 2300 },
    ])).toEqual({ eggs: 35, totalCents: 4000 });
  });

  it("retorna zero para lista vazia", () => {
    expect(calculateTotals([])).toEqual({ eggs: 0, totalCents: 0 });
  });

  it.each([-1, 0, 1.5, NaN, Infinity, -Infinity])(
    "rejeita ovos por bandeja inválidos: %s",
    eggsPerTray => expect(() => calculateTotals([
      { productId: "x", eggsPerTray, trays: 1, priceCents: 0 },
    ])).toThrow(RangeError),
  );

  it.each([-1, 0, 1.5, NaN, Infinity, -Infinity])(
    "rejeita número de bandejas inválido: %s",
    trays => expect(() => calculateTotals([
      { productId: "x", eggsPerTray: 1, trays, priceCents: 0 },
    ])).toThrow(RangeError),
  );

  it.each([-1, 1.5, NaN, Infinity, -Infinity])(
    "rejeita preço em centavos inválido: %s",
    priceCents => expect(() => calculateTotals([
      { productId: "x", eggsPerTray: 1, trays: 1, priceCents },
    ])).toThrow(RangeError),
  );

  it("permite preço zero", () => {
    expect(calculateTotals([
      { productId: "x", eggsPerTray: 1, trays: 1, priceCents: 0 },
    ])).toEqual({ eggs: 1, totalCents: 0 });
  });

  it("rejeita multiplicação que excede inteiro seguro", () => {
    expect(() => calculateTotals([
      { productId: "x", eggsPerTray: Number.MAX_SAFE_INTEGER, trays: 2, priceCents: 0 },
    ])).toThrow(RangeError);
  });

  it("rejeita soma que excede inteiro seguro", () => {
    const items: OrderItem[] = [
      { productId: "a", eggsPerTray: 1, trays: Number.MAX_SAFE_INTEGER, priceCents: 0 },
      { productId: "b", eggsPerTray: 1, trays: 1, priceCents: 0 },
    ];
    expect(() => calculateTotals(items)).toThrow(RangeError);
  });

  it("rejeita preço multiplicado que excede inteiro seguro", () => {
    expect(() => calculateTotals([
      { productId: "x", eggsPerTray: 1, trays: 2, priceCents: Number.MAX_SAFE_INTEGER },
    ])).toThrow(RangeError);
  });

  it("rejeita soma de preços que excede inteiro seguro", () => {
    expect(() => calculateTotals([
      { productId: "a", eggsPerTray: 1, trays: 1, priceCents: Number.MAX_SAFE_INTEGER },
      { productId: "b", eggsPerTray: 1, trays: 1, priceCents: 1 },
    ])).toThrow(RangeError);
  });

  it("rejeita valores individuais acima do inteiro seguro", () => {
    for (const item of [
      { productId: "x", eggsPerTray: Number.MAX_SAFE_INTEGER + 1, trays: 1, priceCents: 0 },
      { productId: "x", eggsPerTray: 1, trays: Number.MAX_SAFE_INTEGER + 1, priceCents: 0 },
      { productId: "x", eggsPerTray: 1, trays: 1, priceCents: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(() => calculateTotals([item])).toThrow(RangeError);
    }
  });

  it("preserva array e itens de entrada", () => {
    const items: OrderItem[] = [
      { productId: "x", eggsPerTray: 30, trays: 2, priceCents: 3000 },
    ];
    const original = structuredClone(items);

    calculateTotals(items);

    expect(items).toEqual(original);
  });
});
