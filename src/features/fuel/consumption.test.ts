import { describe, expect, it } from "vitest";
import { estimateRouteFuel, measureConsumption } from "./consumption";
import type { FuelEvent } from "./consumption";

const fuelEvent = (
  id: string,
  occurredAt: string,
  odometerKm: number,
  litres: number,
  fullTank: boolean,
  fuelType = "gasolina",
  reversed = false,
): FuelEvent => ({
  id, occurredAt, odometerKm, litres, totalCents: 1000, fuelType, fullTank, reversed,
});

describe("measureConsumption", () => {
  it("mede do último tanque cheio ao próximo e exclui litros do primeiro", () => {
    const events = [
      fuelEvent("close", "2026-01-03T10:00:00Z", 1300, 20, true),
      fuelEvent("partial", "2026-01-02T10:00:00Z", 1100, 10, false),
      fuelEvent("start", "2026-01-01T10:00:00Z", 1000, 40, true),
    ];

    expect(measureConsumption(events)).toEqual({
      kmPerLitre: 10,
      from: "2026-01-01T10:00:00Z",
      to: "2026-01-03T10:00:00Z",
      fuelType: "gasolina",
    });
    expect(events.map(event => event.id)).toEqual(["close", "partial", "start"]);
  });

  it("não calcula sem dois tanques cheios", () => {
    expect(measureConsumption([
      fuelEvent("start", "2026-01-01T10:00:00Z", 1000, 40, true),
      fuelEvent("partial", "2026-01-02T10:00:00Z", 1100, 10, false),
    ])).toBeNull();
  });

  it("ignora eventos posteriores ao último tanque cheio", () => {
    expect(measureConsumption([
      fuelEvent("start", "2026-01-01T10:00:00Z", 1000, 40, true),
      fuelEvent("close", "2026-01-02T10:00:00Z", 1200, 20, true),
      fuelEvent("later-partial", "2026-01-03T10:00:00Z", 1300, 10, false),
    ])).toMatchObject({
      kmPerLitre: 10,
      to: "2026-01-02T10:00:00Z",
    });
  });

  it("ignora eventos estornados", () => {
    expect(measureConsumption([
      fuelEvent("start", "2026-01-01T10:00:00Z", 1000, 40, true),
      fuelEvent("reversed", "2026-01-02T10:00:00Z", 1100, 10, false, "diesel", true),
      fuelEvent("close", "2026-01-03T10:00:00Z", 1300, 20, true),
    ])).toMatchObject({ kmPerLitre: 15, fuelType: "gasolina" });
  });

  it("usa intervalo completo válido mais recente quando intervalo posterior é inválido", () => {
    expect(measureConsumption([
      fuelEvent("a", "2026-01-01T10:00:00Z", 1000, 30, true, "diesel"),
      fuelEvent("b", "2026-01-02T10:00:00Z", 1200, 20, true, "diesel"),
      fuelEvent("c", "2026-01-03T10:00:00Z", 1300, 15, true, "gasolina"),
      fuelEvent("d", "2026-01-04T10:00:00Z", 1500, 20, true, "diesel"),
    ])).toEqual({
      kmPerLitre: 10,
      from: "2026-01-01T10:00:00Z",
      to: "2026-01-02T10:00:00Z",
      fuelType: "diesel",
    });
  });

  it.each([
    ["mistura combustível", [
      fuelEvent("a", "2026-01-01T10:00:00Z", 1000, 20, true, "gasolina"),
      fuelEvent("b", "2026-01-02T10:00:00Z", 1100, 10, false, "diesel"),
      fuelEvent("c", "2026-01-03T10:00:00Z", 1200, 20, true, "gasolina"),
    ]],
    ["hodômetro decrescente", [
      fuelEvent("a", "2026-01-01T10:00:00Z", 1000, 20, true),
      fuelEvent("b", "2026-01-02T10:00:00Z", 900, 20, true),
    ]],
    ["distância zero", [
      fuelEvent("a", "2026-01-01T10:00:00Z", 1000, 20, true),
      fuelEvent("b", "2026-01-02T10:00:00Z", 1000, 20, true),
    ]],
    ["timestamp ambíguo", [
      fuelEvent("b", "2026-01-01T10:00:00Z", 1100, 10, false),
      fuelEvent("a", "2026-01-01T10:00:00Z", 1000, 20, true),
      fuelEvent("c", "2026-01-03T10:00:00Z", 1200, 20, true),
    ]],
  ])("retorna null para intervalo com %s", (_name, events) => {
    expect(measureConsumption(events as FuelEvent[])).toBeNull();
  });

  it.each([
    ["data inválida", { occurredAt: "amanhã" }],
    ["hodômetro negativo", { odometerKm: -1 }],
    ["hodômetro fracionário", { odometerKm: 1.5 }],
    ["hodômetro fora da faixa segura", { odometerKm: Number.MAX_SAFE_INTEGER + 1 }],
    ["litros negativos", { litres: -1 }],
    ["litros zero", { litres: 0 }],
    ["litros infinitos", { litres: Infinity }],
    ["litros NaN", { litres: NaN }],
    ["centavos negativos", { totalCents: -1 }],
    ["centavos fracionários", { totalCents: 1.5 }],
    ["centavos fora da faixa segura", { totalCents: Number.MAX_SAFE_INTEGER + 1 }],
    ["combustível vazio", { fuelType: " " }],
  ])("rejeita %s", (_name, override) => {
    const invalid = { ...fuelEvent("bad", "2026-01-01T10:00:00Z", 1000, 10, true), ...override };
    expect(() => measureConsumption([invalid as FuelEvent])).toThrow(RangeError);
  });
});

describe("estimateRouteFuel", () => {
  it("calcula litros e custo em centavos", () => {
    expect(estimateRouteFuel(86, 10, 600)).toEqual({ litres: 8.6, costCents: 5160 });
  });

  it("retorna null quando consumo ou preço não estão disponíveis", () => {
    expect(estimateRouteFuel(86, null, 600)).toBeNull();
    expect(estimateRouteFuel(86, 10, null)).toBeNull();
  });

  it("retorna zeros para distância zero", () => {
    expect(estimateRouteFuel(0, 10, 600)).toEqual({ litres: 0, costCents: 0 });
  });

  it.each([
    [-1, 10, 600],
    [Infinity, 10, 600],
    [86, 0, 600],
    [86, -1, 600],
    [86, Infinity, 600],
    [86, 10, -1],
    [86, 10, Infinity],
  ])("rejeita parâmetros inválidos %s/%s/%s", (km, kmPerLitre, price) => {
    expect(() => estimateRouteFuel(km, kmPerLitre, price)).toThrow(RangeError);
  });

  it("rejeita custo arredondado fora do inteiro seguro", () => {
    expect(() => estimateRouteFuel(Number.MAX_VALUE, 1, 1)).toThrow(RangeError);
  });
});
