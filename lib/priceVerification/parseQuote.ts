/**
 * Quote-extract parser for Coles and Woolworths weekly price files.
 *
 * FORMAT FACTS (verified against the real files, do not rediscover)
 *  - Woolworths "Weekly PQF" downloads as `.xls` but is an HTML page from the
 *    Salesforce partner hub with a <table> in it. It is NOT an Excel workbook.
 *    SheetJS reads it anyway — its HTML path finds the table — so both formats
 *    go through XLSX.read(). The file does not start with <table>; it opens
 *    with a <script> block, which is why sniffing on the first bytes alone is
 *    not enough.
 *  - Coles is a genuine .xlsx with Excel serial dates in Start/End Date.
 *  - Retailer is detected from the HEADER ROW CONTENT, never the filename.
 *    Both retailers' files get renamed constantly by whoever downloads them.
 *
 * SHAPE DIFFERENCE, AND WHY BOTH BECOME PER-DAY ROWS
 *    Coles gives one row per article × DC with a start/end range.
 *    Woolworths gives one row per article × DC with SEVEN price columns, one
 *    per weekday, each headed with its own date.
 *  Flattening Woolworths to a single week price would quietly discard a
 *  mid-week price change. Expanding both to one row per DAY instead makes the
 *  downstream lookup an exact key — (dc, article, delivery date) — and keeps
 *  whatever per-day detail the source had.
 *
 * DEFENSIVE PARSING
 *  Every row that cannot be used produces a ParseWarning carrying its 1-based
 *  sheet row number. Nothing is dropped silently. A file that yields zero
 *  usable lines throws rather than storing an empty quote that would later
 *  read as "nothing to verify".
 */
import * as XLSX from "xlsx";
import type { ParseWarning, ParsedQuote, QuoteLine, Retailer } from "./types";

export class QuoteParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteParseError";
  }
}

type Cell = string | number | boolean | null | undefined;
type Row = Cell[];

const MAX_HEADER_SCAN_ROWS = 25;

// --------------------------------------------------------------- entrypoint

/**
 * Parses an uploaded quote file. `fileName` is used only in error messages —
 * detection is on content.
 */
export function parseQuoteFile(buffer: Buffer, fileName = "upload"): ParsedQuote {
  let rows: Row[];
  try {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw new QuoteParseError("workbook contains no sheets");
    rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[sheetName]!, {
      header: 1,
      raw: true,
      defval: null,
    });
  } catch (err) {
    if (err instanceof QuoteParseError) throw err;
    throw new QuoteParseError(
      `could not read "${fileName}" as a spreadsheet or HTML table: ` +
        (err instanceof Error ? err.message : String(err))
    );
  }

  if (rows.length === 0) throw new QuoteParseError(`"${fileName}" is empty`);

  const detected = detectRetailer(rows);
  if (!detected) {
    throw new QuoteParseError(
      `could not tell which retailer "${fileName}" is from. Expected a Coles ` +
        `sheet with DC/Product/Price/Start Date columns, or a Woolworths ` +
        `Weekly PQF with Article #/DC-DSD columns.`
    );
  }

  const parsed =
    detected.retailer === "coles"
      ? parseColes(rows, detected.headerRow)
      : parseWoolworths(rows, detected.headerRow);

  if (parsed.lines.length === 0) {
    throw new QuoteParseError(
      `"${fileName}" parsed as ${detected.retailer} but yielded no usable quote ` +
        `lines (${parsed.warnings.length} unusable rows). First problem: ` +
        (parsed.warnings[0]?.reason ?? "unknown")
    );
  }

  return parsed;
}

// ---------------------------------------------------------------- detection

interface Detection {
  retailer: Retailer;
  headerRow: number;
}

/** Finds the header row and, from its column names, which retailer this is. */
export function detectRetailer(rows: Row[]): Detection | null {
  const limit = Math.min(rows.length, MAX_HEADER_SCAN_ROWS);
  for (let i = 0; i < limit; i++) {
    const labels = (rows[i] ?? []).map(normaliseHeader);
    const has = (name: string) => labels.includes(name);

    // Woolworths Weekly PQF.
    if (has("article #") && (has("dc/dsd") || has("dc/dsd#"))) {
      return { retailer: "woolworths", headerRow: i };
    }
    // Coles supplier quotes.
    if (has("dc") && has("product") && has("price") && has("start date")) {
      return { retailer: "coles", headerRow: i };
    }
  }
  return null;
}

function normaliseHeader(c: Cell): string {
  return String(c ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// -------------------------------------------------------------------- Coles

function parseColes(rows: Row[], headerRow: number): ParsedQuote {
  const labels = (rows[headerRow] ?? []).map(normaliseHeader);
  const col = (name: string) => labels.indexOf(name);

  const cDc = col("dc");
  const cProduct = col("product");
  const cDesc = col("description");
  const cMultiple = col("order multiple");
  const cPrice = col("price");
  const cStart = col("start date");
  const cEnd = col("end date");
  const cApproved = col("approved?");

  const warnings: ParseWarning[] = [];
  const lines: QuoteLine[] = [];
  const dcCodes = new Set<string>();
  let rowCount = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rowNo = i + 1;
    if (isBlankRow(row)) continue;

    const dc = text(row[cDc]);
    const article = text(row[cProduct]);
    if (!dc || !article) {
      warnings.push({
        row: rowNo,
        reason: !dc ? "no DC code" : "no product code",
        sample: sampleOf(row),
      });
      continue;
    }

    const start = toIsoDate(row[cStart]);
    const end = toIsoDate(row[cEnd]);
    if (!start || !end) {
      warnings.push({
        row: rowNo,
        reason: "start/end date missing or unreadable",
        sample: sampleOf(row),
      });
      continue;
    }
    if (end < start) {
      warnings.push({
        row: rowNo,
        reason: `end date ${end} precedes start date ${start}`,
        sample: sampleOf(row),
      });
      continue;
    }

    const days = eachDay(start, end);
    if (days.length === 0 || days.length > 366) {
      warnings.push({
        row: rowNo,
        reason: `implausible date range ${start}..${end}`,
        sample: sampleOf(row),
      });
      continue;
    }

    rowCount++;
    dcCodes.add(dc);
    if (minDate === null || start < minDate) minDate = start;
    if (maxDate === null || end > maxDate) maxDate = end;

    // A blank price is normal in these files and is NOT a parse failure — it
    // becomes a line the comparison reports as "quote has no price".
    const price = toNumber(row[cPrice]);
    const approved = normaliseHeader(row[cApproved]) === "checked";

    for (const day of days) {
      lines.push({
        retailer: "coles",
        dcCode: dc,
        articleNo: article,
        description: text(row[cDesc]),
        effectiveOn: day,
        price,
        approved,
        orderMultiple: toNumber(row[cMultiple]),
      });
    }
  }

  return {
    retailer: "coles",
    periodStart: minDate ?? "",
    periodEnd: maxDate ?? "",
    lines: dedupeLines(lines, warnings),
    warnings,
    rowCount,
    dcCodes: Array.from(dcCodes).sort(),
  };
}

// ------------------------------------------------------------- Woolworths

function parseWoolworths(rows: Row[], headerRow: number): ParsedQuote {
  const labels = (rows[headerRow] ?? []).map(normaliseHeader);
  const col = (name: string) => labels.indexOf(name);

  const cArticle = col("article #");
  const cDesc = col("description");
  const cMultiple = col("om");
  const cDcNo = col("dc/dsd#") >= 0 ? col("dc/dsd#") : col("dc/dsd");
  const cDcLabel = col("dc/dsd");
  const cStatus = col("status");
  const cVersion = col("latest version ?");

  const priceCols = findWoolworthsPriceColumns(rows, headerRow);

  const warnings: ParseWarning[] = [];
  const lines: QuoteLine[] = [];
  const dcCodes = new Set<string>();
  let rowCount = 0;

  if (priceCols.length === 0) {
    warnings.push({
      row: headerRow + 1,
      reason:
        "no dated price columns found under the Price header — the weekday " +
        "columns are how a Woolworths PQF carries its prices",
    });
    return {
      retailer: "woolworths",
      periodStart: "",
      periodEnd: "",
      lines: [],
      warnings,
      rowCount: 0,
      dcCodes: [],
    };
  }

  const dates = priceCols.map((p) => p.date).sort();
  const periodStart = dates[0]!;
  const periodEnd = dates[dates.length - 1]!;

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rowNo = i + 1;
    if (isBlankRow(row)) continue;

    const article = text(row[cArticle]);
    const dc = text(row[cDcNo]);
    if (!article || !dc) {
      warnings.push({
        row: rowNo,
        reason: !article ? "no article number" : "no DC/DSD number",
        sample: sampleOf(row),
      });
      continue;
    }

    // Only "Approved" + "Current" rows describe the price actually in force.
    // Superseded versions sit in the same table and would otherwise compete.
    const status = normaliseHeader(row[cStatus]);
    const version = normaliseHeader(row[cVersion]);
    if (cVersion >= 0 && version && version !== "current") {
      warnings.push({
        row: rowNo,
        reason: `superseded version row (Latest Version = "${text(row[cVersion])}")`,
        sample: sampleOf(row),
      });
      continue;
    }
    const approved = cStatus < 0 || status === "approved";

    rowCount++;
    dcCodes.add(dc);

    for (const pc of priceCols) {
      lines.push({
        retailer: "woolworths",
        dcCode: dc,
        articleNo: article,
        description: text(row[cDesc]),
        effectiveOn: pc.date,
        price: toNumber(row[pc.index]),
        approved,
        orderMultiple: toNumber(row[cMultiple]),
      });
    }

    if (cDcLabel >= 0 && !text(row[cDcLabel])) {
      // Not fatal; the DC number is the key. Recorded so an odd file is visible.
      warnings.push({
        row: rowNo,
        reason: "DC/DSD label blank (DC number used instead)",
        sample: sampleOf(row),
      });
    }
  }

  return {
    retailer: "woolworths",
    periodStart,
    periodEnd,
    lines: dedupeLines(lines, warnings),
    warnings,
    rowCount,
    dcCodes: Array.from(dcCodes).sort(),
  };
}

/**
 * Locates the per-weekday price columns.
 *
 * The sheet has a two-row header: a group row with "Price" and "Quantity"
 * spanning their blocks, then the real header row where BOTH blocks repeat the
 * same seven dated weekday labels. Matching dated labels alone would therefore
 * pick up the quantity columns too and read quantities as prices. The group row
 * is what disambiguates, so it is found first and the price block is bounded by
 * where "Quantity" starts.
 */
function findWoolworthsPriceColumns(
  rows: Row[],
  headerRow: number
): { index: number; date: string }[] {
  const header = rows[headerRow] ?? [];
  const group = headerRow > 0 ? (rows[headerRow - 1] ?? []) : [];

  let priceStart = -1;
  let priceEnd = header.length;
  for (let c = 0; c < group.length; c++) {
    const g = normaliseHeader(group[c]);
    if (g === "price" && priceStart < 0) priceStart = c;
    else if (g === "quantity" && priceStart >= 0 && c > priceStart) {
      priceEnd = c;
      break;
    }
  }

  const out: { index: number; date: string }[] = [];
  for (let c = 0; c < header.length; c++) {
    if (priceStart >= 0 && (c < priceStart || c >= priceEnd)) continue;
    const date = parseWeekdayHeaderDate(header[c]);
    if (date) out.push({ index: c, date });
  }

  // No group row at all: fall back to the FIRST contiguous run of dated
  // columns, which is the price block in every sample seen.
  if (priceStart < 0 && out.length > 0) {
    const contiguous: typeof out = [out[0]!];
    for (let i = 1; i < out.length; i++) {
      if (out[i]!.index === contiguous[contiguous.length - 1]!.index + 1) {
        contiguous.push(out[i]!);
      } else break;
    }
    return contiguous;
  }

  return out;
}

/** "Tuesday (03-Mar-26)" → "2026-03-03". */
export function parseWeekdayHeaderDate(cell: Cell): string | null {
  const s = String(cell ?? "");
  const m = s.match(/\((\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{2,4})\)/);
  if (!m) return null;
  const day = parseInt(m[1]!, 10);
  const month = MONTHS[m[2]!.slice(0, 3).toLowerCase()];
  if (month === undefined) return null;
  let year = parseInt(m[3]!, 10);
  if (year < 100) year += 2000;
  return isoFromParts(year, month, day);
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// ------------------------------------------------------------------ helpers

/**
 * Two rows for the same article × DC × day is a contradiction — the file is
 * telling us two prices for one thing. Keep the FIRST and warn, rather than
 * letting an arbitrary later row win silently.
 */
function dedupeLines(lines: QuoteLine[], warnings: ParseWarning[]): QuoteLine[] {
  const seen = new Map<string, QuoteLine>();
  const conflicts = new Set<string>();
  for (const l of lines) {
    const key = `${l.dcCode}|${l.articleNo}|${l.effectiveOn}`;
    const prior = seen.get(key);
    if (!prior) {
      seen.set(key, l);
      continue;
    }
    if (prior.price !== l.price && !conflicts.has(key)) {
      conflicts.add(key);
      warnings.push({
        row: 0,
        reason:
          `two different prices quoted for article ${l.articleNo} at DC ` +
          `${l.dcCode} on ${l.effectiveOn} (${prior.price} and ${l.price}); ` +
          `the first was kept`,
      });
    }
  }
  return Array.from(seen.values());
}

function isBlankRow(row: Row): boolean {
  return row.every((c) => c === null || c === undefined || String(c).trim() === "");
}

function sampleOf(row: Row): string {
  return row
    .slice(0, 6)
    .map((c) => (c === null || c === undefined ? "" : String(c)))
    .join(" | ")
    .slice(0, 160);
}

function text(c: Cell): string | null {
  if (c === null || c === undefined) return null;
  const s = String(c).trim();
  return s === "" ? null : s;
}

function toNumber(c: Cell): number | null {
  if (c === null || c === undefined || c === "") return null;
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  const cleaned = String(c).replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Excel serial or date-ish string → ISO yyyy-mm-dd.
 *
 * Serials are read as a UTC day count from the 1899-12-30 epoch and formatted
 * without ever constructing a local-time Date, so the machine's timezone cannot
 * shift a quote by a day. That matters: the app runs in syd1 but a developer
 * machine may not.
 */
export function toIsoDate(c: Cell): string | null {
  if (c === null || c === undefined || c === "") return null;

  if (typeof c === "number" && Number.isFinite(c)) {
    if (c < 1 || c > 2_958_465) return null; // outside 1900-01-01 .. 9999-12-31
    const ms = Math.round(c) * 86_400_000 + Date.UTC(1899, 11, 30);
    const d = new Date(ms);
    return isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  const s = String(c).trim();

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return isoFromParts(+m[1]!, +m[2]!, +m[3]!);

  // dd/mm/yyyy — Australian order. These files are AU-sourced throughout.
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let year = +m[3]!;
    if (year < 100) year += 2000;
    return isoFromParts(year, +m[2]!, +m[1]!);
  }

  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{2,4})/);
  if (m) {
    const month = MONTHS[m[2]!.slice(0, 3).toLowerCase()];
    if (month === undefined) return null;
    let year = +m[3]!;
    if (year < 100) year += 2000;
    return isoFromParts(year, month, +m[1]!);
  }

  return null;
}

function isoFromParts(year: number, month: number, day: number): string | null {
  if (
    !Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) ||
    month < 1 || month > 12 || day < 1 || day > 31 ||
    year < 1900 || year > 9999
  ) {
    return null;
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) return null; // e.g. 31 Feb
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
}

/** Inclusive list of ISO dates from `start` to `end`. */
export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  let cursor = Date.parse(`${start}T00:00:00Z`);
  const last = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(cursor) || Number.isNaN(last)) return out;
  while (cursor <= last && out.length <= 400) {
    const d = new Date(cursor);
    out.push(
      `${pad4(d.getUTCFullYear())}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
    );
    cursor += 86_400_000;
  }
  return out;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function pad4(n: number): string {
  return String(n).padStart(4, "0");
}
