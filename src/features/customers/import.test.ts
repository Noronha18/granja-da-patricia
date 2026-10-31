import { describe, expect, it } from "vitest";
import { parseCustomerCsv } from "./import";

const header = "source_id,name,phone,address,weekday,position,eggs_per_tray,trays";

describe("parseCustomerCsv", () => {
  it("lê BOM, CRLF, campos com vírgula, aspas escapadas e quebra de linha", () => {
    const csv = "\uFEFF" + header + "\r\n" +
      'cliente-1,"Sítio, ""São João""",,"Rua das Flores\r\nCasa 2",2,1,15,3\r\n';

    const result = parseCustomerCsv(csv);

    expect(result.issues).toEqual([]);
    expect(result.rows).toEqual([{
      sourceId: "cliente-1",
      name: 'Sítio, "São João"',
      phone: null,
      address: "Rua das Flores\r\nCasa 2",
      weekday: 2,
      position: 1,
      eggsPerTray: 15,
      trays: 3,
    }]);
  });

  it("valida os campos numéricos e informa linha e campo inválidos", () => {
    const result = parseCustomerCsv([
      header,
      "cliente-1,Ana,5511999999999,Rua A,1,1,18,1",
    ].join("\n"));

    expect(result.rows).toEqual([]);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 2, field: "weekday" }),
      expect.objectContaining({ row: 2, field: "eggs_per_tray" }),
    ]));
  });

  it("rejeita texto obrigatório vazio e números fora das regras", () => {
    const result = parseCustomerCsv([
      header,
      ", , , ,2,0,30,9007199254740992",
    ].join("\n"));

    expect(result.rows).toEqual([]);
    expect(result.issues.map(issue => issue.field)).toEqual(expect.arrayContaining([
      "source_id", "name", "address", "position", "trays",
    ]));
  });

  it("aceita o limite integer do banco para posição e bandejas", () => {
    const result = parseCustomerCsv([
      header,
      "cliente-1,Ana,5511999999999,Rua A,2,2147483647,15,2147483647",
    ].join("\n"));

    expect(result.issues).toEqual([]);
    expect(result.rows[0]).toMatchObject({ position: 2147483647, trays: 2147483647 });
  });

  it.each(["position", "trays"] as const)(
    "rejeita %s acima do limite e bloqueia o grupo inteiro",
    field => {
      const columns = ["cliente-1", "Ana", "5511999999999", "Rua A", "2", "1", "15", "1"];
      const fieldIndex = field === "position" ? 5 : 7;
      const invalidRow = [...columns];
      invalidRow[fieldIndex] = "2147483648";
      const result = parseCustomerCsv([
        header,
        columns.join(","),
        invalidRow.join(","),
        "cliente-1,Ana,5511999999999,Rua A,2,1,20,1",
        "cliente-2,Bia,5511888888888,Rua B,3,2,30,1",
      ].join("\n"));

      expect(result.rows.map(row => row.sourceId)).toEqual(["cliente-2"]);
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          row: 3, field, message: expect.stringContaining("2147483647"),
        }),
        expect.objectContaining({ row: 4, field: "_group" }),
      ]));
    },
  );

  it("não descarta silenciosamente linha com número de colunas incorreto", () => {
    const result = parseCustomerCsv([
      header,
      "cliente-1,Ana,5511999999999,Rua A,2,1,15",
      "cliente-2,Bia,5511999999999,Rua B,3,2,20,1",
    ].join("\n"));

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].sourceId).toBe("cliente-2");
    expect(result.issues).toEqual([
      expect.objectContaining({ row: 2, field: "_row" }),
      expect.objectContaining({ row: 2, field: "_group" }),
    ]);
  });

  it("mantém pessoas distintas com telefone compartilhado", () => {
    const result = parseCustomerCsv([
      header,
      "cliente-1,Ana,5511999999999,Rua A,2,1,15,1",
      "cliente-2,Bia,5511999999999,Rua B,3,2,20,2",
    ].join("\n"));

    expect(result.issues).toEqual([]);
    expect(result.rows.map(row => row.sourceId)).toEqual(["cliente-1", "cliente-2"]);
  });

  it("permite produtos distintos e rejeita produto repetido para o mesmo source_id", () => {
    const result = parseCustomerCsv([
      header,
      "cliente-1,Ana,5511999999999,Rua A,2,1,15,1",
      "cliente-1,Ana,5511999999999,Rua A,2,1,20,2",
      "cliente-1,Ana,5511999999999,Rua A,2,1,15,3",
      "cliente-1,Ana,5511999999999,Rua A,2,1,30,1",
      "cliente-2,Bia,5511888888888,Rua B,3,2,20,1",
    ].join("\n"));

    expect(result.rows.map(row => row.sourceId)).toEqual(["cliente-2"]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        row: 4, field: "eggs_per_tray", message: expect.stringContaining("conferência"),
      }),
      expect.objectContaining({ row: 5, field: "_group" }),
    ]);
  });

  it("bloqueia todas as linhas após conflito e mantém outro cliente válido", () => {
    const result = parseCustomerCsv([
      header,
      "cliente-1,Ana,5511999999999,Rua A,2,1,15,1",
      "cliente-1,Ana,5511999999999,Rua B,2,1,20,1",
      "cliente-1,Ana,5511999999999,Rua A,2,1,30,1",
      "cliente-2,Bia,5511888888888,Rua B,3,2,20,1",
    ].join("\n"));

    expect(result.rows.map(row => row.sourceId)).toEqual(["cliente-2"]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        row: 3, field: "address", message: expect.stringContaining("conferência"),
      }),
      expect.objectContaining({ row: 4, field: "_group" }),
    ]);
  });

  it("bloqueia o cliente inteiro se uma linha tiver campo inválido", () => {
    const result = parseCustomerCsv([
      header,
      "cliente-1,Ana,5511999999999,Rua A,2,1,15,1",
      "cliente-1,Ana,5511999999999,Rua A,1,1,20,1",
      "cliente-1,Ana,5511999999999,Rua A,2,1,30,1",
      "cliente-2,Bia,5511888888888,Rua B,3,2,20,1",
    ].join("\n"));

    expect(result.rows.map(row => row.sourceId)).toEqual(["cliente-2"]);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 3, field: "weekday" }),
      expect.objectContaining({ row: 3, field: "_group" }),
      expect.objectContaining({ row: 4, field: "_group" }),
    ]));
  });

  it("numera issues por registro CSV mesmo após endereço multilinha", () => {
    const result = parseCustomerCsv([
      header,
      'cliente-1,Ana,,"Rua A\nCasa 2",2,1,15,1',
      "cliente-2,Bia,,Rua B,1,2,20,1",
    ].join("\n"));

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 3, field: "weekday" }),
    ]));
    expect(result.rows).toHaveLength(1);
  });

  it("emite issue para CSV com aspas malformadas", () => {
    const result = parseCustomerCsv([
      header,
      'cliente-1,"Ana,Rua,5511999999999,Rua A,2,1,15,1',
      "cliente-2,Bia,5511999999999,Rua B,3,2,20,1",
    ].join("\n"));

    expect(result.issues).toEqual([
      expect.objectContaining({
        row: 2, field: "_row", message: expect.stringContaining("Corrija"),
      }),
    ]);
    expect(result.rows).toEqual([]);
  });

  it("bloqueia o arquivo inteiro se houver sintaxe malformada com source_id incerto", () => {
    const result = parseCustomerCsv([
      header,
      "cliente-1,Ana,5511999999999,Rua A,2,1,15,1",
      'cliente-1,Ana "quebrada,5511999999999,Rua A,2,1,20,1',
      "cliente-2,Bia,5511888888888,Rua B,3,2,20,1",
    ].join("\n"));

    expect(result.rows).toEqual([]);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        row: 3, field: "_row", message: expect.stringContaining("Corrija"),
      }),
    ]));
  });
});
