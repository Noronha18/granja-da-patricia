export type ImportedCustomer = {
  sourceId: string;
  name: string;
  phone: string | null;
  address: string;
  weekday: number;
  position: number;
  eggsPerTray: 15 | 20 | 30;
  trays: number;
};

export type ImportIssue = {
  /** CSV record number; header is 1 and quoted newlines stay within one record. */
  row: number;
  field: string;
  message: string;
};

type CsvRecord = { row: number; values: string[]; malformed: boolean };

const columns = [
  "source_id", "name", "phone", "address", "weekday", "position", "eggs_per_tray", "trays",
];
const maxDatabaseInteger = 2147483647;

function readCsv(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let values: string[] = [];
  let value = "";
  let row = 1;
  let inQuotes = false;
  let afterQuote = false;
  let malformed = false;
  let touched = false;

  const finishRecord = () => {
    values.push(value);
    records.push({ row, values, malformed });
    values = [];
    value = "";
    row++;
    inQuotes = false;
    afterQuote = false;
    malformed = false;
    touched = false;
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const newline = char === "\n" || char === "\r";
    if (inQuotes && !malformed) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        value += char;
      }
      touched = true;
      continue;
    }

    if (newline) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      finishRecord();
      continue;
    }
    if (malformed) continue;

    if (afterQuote) {
      if (char === ",") {
        values.push(value);
        value = "";
        afterQuote = false;
        touched = true;
      } else {
        malformed = true;
      }
      continue;
    }
    if (char === ",") {
      values.push(value);
      value = "";
      touched = true;
    } else if (char === '"') {
      if (value.length === 0) {
        inQuotes = true;
        touched = true;
      } else {
        malformed = true;
      }
    } else {
      value += char;
      touched = true;
    }
  }

  if (inQuotes) malformed = true;
  if (touched || values.length > 0 || value.length > 0 || malformed) finishRecord();
  return records;
}

function issue(row: number, field: string, message: string): ImportIssue {
  return { row, field, message };
}

function parseInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseCustomerCsv(text: string): { rows: ImportedCustomer[]; issues: ImportIssue[] } {
  const records = readCsv(text.startsWith("\uFEFF") ? text.slice(1) : text);
  const rows: ImportedCustomer[] = [];
  const issues: ImportIssue[] = [];
  const first = records.shift();
  if (!first) return { rows, issues: [issue(1, "_header", "CSV sem cabeçalho")] };
  if (first.malformed) {
    return { rows, issues: [issue(1, "_header", "Cabeçalho CSV malformado. Corrija antes de importar.")] };
  }

  const header = first.values.map(value => value.trim());
  const indexes = new Map(header.map((field, index) => [field, index]));
  const invalidHeaders = columns.filter(field => !indexes.has(field));
  const duplicateHeaders = header.filter((field, index) => header.indexOf(field) !== index);
  if (invalidHeaders.length || duplicateHeaders.length) {
    for (const field of invalidHeaders) issues.push(issue(1, field, "Coluna obrigatória ausente"));
    for (const field of new Set(duplicateHeaders)) issues.push(issue(1, field, "Coluna duplicada"));
    return { rows, issues };
  }

  const customers = new Map<string, Omit<ImportedCustomer, "eggsPerTray" | "trays">>();
  const products = new Set<string>();
  const rejected = new Set<string>();
  let hasMalformedRecord = false;
  const reviewMessage = "Cadastro exige conferência antes da importação";
  const rejectCustomer = (sourceId: string, row: number, field: string) => {
    rejected.add(sourceId);
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].sourceId === sourceId) rows.splice(i, 1);
    }
    issues.push(issue(row, field, reviewMessage));
  };

  for (const record of records) {
    if (record.malformed) {
      hasMalformedRecord = true;
      issues.push(issue(record.row, "_row", "Sintaxe CSV inválida. Corrija antes de importar."));
      continue;
    }
    const sourceIndex = indexes.get("source_id")!;
    const sourceId = record.values[sourceIndex]?.trim() ?? "";
    if (sourceId && rejected.has(sourceId)) {
      issues.push(issue(record.row, "_group", reviewMessage));
      continue;
    }
    if (record.values.length !== header.length) {
      issues.push(issue(record.row, "_row", "Número de colunas incorreto"));
      if (sourceId) rejectCustomer(sourceId, record.row, "_group");
      continue;
    }
    const get = (field: string) => record.values[indexes.get(field)!].trim();
    const name = get("name");
    const phoneText = get("phone");
    const phone = phoneText || null;
    const address = get("address");
    const weekday = parseInteger(get("weekday"));
    const position = parseInteger(get("position"));
    const eggsPerTray = parseInteger(get("eggs_per_tray"));
    const trays = parseInteger(get("trays"));
    const rowIssues: ImportIssue[] = [];

    if (!sourceId) rowIssues.push(issue(record.row, "source_id", "Obrigatório"));
    if (!name) rowIssues.push(issue(record.row, "name", "Obrigatório"));
    if (!address) rowIssues.push(issue(record.row, "address", "Obrigatório"));
    if (weekday === null || weekday < 2 || weekday > 5) {
      rowIssues.push(issue(record.row, "weekday", "Use dia inteiro entre 2 e 5"));
    }
    if (position === null || position <= 0) {
      rowIssues.push(issue(record.row, "position", "Use inteiro positivo"));
    } else if (position > maxDatabaseInteger) {
      rowIssues.push(issue(record.row, "position", "Máximo permitido: 2147483647"));
    }
    if (eggsPerTray !== 15 && eggsPerTray !== 20 && eggsPerTray !== 30) {
      rowIssues.push(issue(record.row, "eggs_per_tray", "Use 15, 20 ou 30"));
    }
    if (trays === null || trays <= 0) {
      rowIssues.push(issue(record.row, "trays", "Use inteiro positivo"));
    } else if (trays > maxDatabaseInteger) {
      rowIssues.push(issue(record.row, "trays", "Máximo permitido: 2147483647"));
    }
    if (rowIssues.length) {
      issues.push(...rowIssues);
      if (sourceId) rejectCustomer(sourceId, record.row, "_group");
      continue;
    }

    const customer = {
      sourceId,
      name,
      phone,
      address,
      weekday: weekday!,
      position: position!,
    };
    const existing = customers.get(sourceId);
    if (existing) {
      const conflicts = (["name", "phone", "address", "weekday", "position"] as const)
        .filter(field => existing[field] !== customer[field]);
      if (conflicts.length) {
        for (const field of conflicts) rejectCustomer(sourceId, record.row, field);
        continue;
      }
    } else {
      customers.set(sourceId, customer);
    }

    const productKey = JSON.stringify([sourceId, eggsPerTray]);
    if (products.has(productKey)) {
      rejectCustomer(sourceId, record.row, "eggs_per_tray");
      continue;
    }
    products.add(productKey);
    rows.push({ ...customer, eggsPerTray: eggsPerTray as 15 | 20 | 30, trays: trays! });
  }

  if (hasMalformedRecord) rows.length = 0;
  return { rows, issues };
}
