import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  detectRetailer,
  eachDay,
  parseQuoteFile,
  parseWeekdayHeaderDate,
  QuoteParseError,
  toIsoDate,
} from "./parseQuote";

// --------------------------------------------------------------- fixtures

/** Builds a real .xlsx buffer from rows, the way Coles ships one. */
function xlsxBuffer(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Builds an HTML table named .xls, the way the Woolworths portal ships one. */
function wowHtmlBuffer(rows: (string | number | null)[][]): Buffer {
  const cells = (r: (string | number | null)[]) =>
    r.map((c) => `<td>${c === null ? "" : String(c)}</td>`).join("");
  const html =
    `<script>var x = 1;</script><table>` +
    rows.map((r) => `<tr>${cells(r)}</tr>`).join("") +
    `</table>`;
  return Buffer.from(html, "utf8");
}

const COLES_HEADER = [
  "DC", "Product", "Description", "Order Multiple", "Price",
  "Start Date", "End Date", "Available Quantity", "Total", "Daily",
  "Approved?", "Comments",
];

/** Excel serials for 2026-04-07 .. 2026-04-13, as they appear in real files. */
const APR7 = 46119;
const APR13 = 46125;

function colesRow(
  dc: string,
  product: string,
  price: number | null,
  approved: "Checked" | "Unchecked" = "Checked",
  start: number | string = APR7,
  end: number | string = APR13
) {
  return [dc, product, `DESC ${product}`, 12, price, start, end, null, 0, null, approved, null];
}

const WOW_ROWS_BASE = [
  ["Weekly PQF\nSupplier:Mackays\nDate:03/03/2026 -09/03/2026"],
  ["Status:Approved"],
  [null, null, null, null, null, null, "Price", null, "Quantity", null],
  [
    "Article #", "Description", "Sub Category", "OM", "DC/DSD", "DC/DSD#",
    "Tuesday (03-Mar-26)", "Wednesday (04-Mar-26)",
    "Tuesday (03-Mar-26)", "Wednesday (04-Mar-26)",
    "Growing Region", "Status", "Latest Version ?",
  ],
];

// =========================================================== detection

describe("retailer detection", () => {
  it("identifies Coles from its header columns, not the file name", () => {
    const buf = xlsxBuffer([COLES_HEADER, colesRow("BRI9415", "4246862", 42)]);
    const parsed = parseQuoteFile(buf, "definitely-a-woolworths-file.xls");
    expect(parsed.retailer).toBe("coles");
  });

  it("identifies Woolworths from an HTML table named .xls", () => {
    const buf = wowHtmlBuffer([
      ...WOW_ROWS_BASE,
      [172659, "Papaya Red", "TROPICAL", 10, "Brisbane RDC", 2986, 27, 27, null, null, "QLD", "Approved", "Current"],
    ]);
    const parsed = parseQuoteFile(buf, "coles-quotes.xlsx");
    expect(parsed.retailer).toBe("woolworths");
  });

  it("returns null when the sheet is neither", () => {
    expect(detectRetailer([["Name", "Amount"], ["a", 1]])).toBeNull();
  });
});

// ============================================================== Coles

describe("Coles quote parsing", () => {
  it("expands a start/end range into one line per day", () => {
    const buf = xlsxBuffer([COLES_HEADER, colesRow("BRI9415", "4246862", 42)]);
    const parsed = parseQuoteFile(buf);

    expect(parsed.rowCount).toBe(1);
    expect(parsed.lines).toHaveLength(7);
    expect(parsed.periodStart).toBe("2026-04-07");
    expect(parsed.periodEnd).toBe("2026-04-13");
    expect(parsed.lines.map((l) => l.effectiveOn)).toEqual([
      "2026-04-07", "2026-04-08", "2026-04-09", "2026-04-10",
      "2026-04-11", "2026-04-12", "2026-04-13",
    ]);
    expect(parsed.lines.every((l) => l.price === 42)).toBe(true);
    expect(parsed.warnings).toHaveLength(0);
  });

  it("keeps a blank price as null rather than dropping the row", () => {
    const buf = xlsxBuffer([COLES_HEADER, colesRow("BRI9415", "2512240", null, "Unchecked")]);
    const parsed = parseQuoteFile(buf);

    expect(parsed.lines).toHaveLength(7);
    expect(parsed.lines[0]!.price).toBeNull();
    expect(parsed.lines[0]!.approved).toBe(false);
    // A blank price is normal data, not a parse problem.
    expect(parsed.warnings).toHaveLength(0);
  });

  it("records Approved? = Checked as the approved flag", () => {
    const buf = xlsxBuffer([
      COLES_HEADER,
      colesRow("BRI9415", "1111111", 10, "Checked"),
      colesRow("BRI9415", "2222222", 20, "Unchecked"),
    ]);
    const parsed = parseQuoteFile(buf);
    expect(parsed.lines.find((l) => l.articleNo === "1111111")!.approved).toBe(true);
    expect(parsed.lines.find((l) => l.articleNo === "2222222")!.approved).toBe(false);
  });

  it("skips malformed rows with a warning naming the row number", () => {
    const buf = xlsxBuffer([
      COLES_HEADER,
      colesRow("BRI9415", "1111111", 10),
      [null, "2222222", "no dc", 12, 20, APR7, APR13, null, 0, null, "Checked", null],
      ["TSV9424", null, "no product", 12, 20, APR7, APR13, null, 0, null, "Checked", null],
    ]);
    const parsed = parseQuoteFile(buf);

    expect(parsed.rowCount).toBe(1);
    expect(parsed.warnings).toHaveLength(2);
    expect(parsed.warnings[0]).toMatchObject({ row: 3, reason: "no DC code" });
    expect(parsed.warnings[1]).toMatchObject({ row: 4, reason: "no product code" });
  });

  it("rejects a row whose end date precedes its start date", () => {
    const buf = xlsxBuffer([
      COLES_HEADER,
      colesRow("BRI9415", "1111111", 10, "Checked", APR13, APR7),
      colesRow("BRI9415", "2222222", 10),
    ]);
    const parsed = parseQuoteFile(buf);
    expect(parsed.rowCount).toBe(1);
    expect(parsed.warnings[0]!.reason).toMatch(/precedes start date/);
  });

  it("warns when the same article at the same DC is quoted twice for a day", () => {
    const buf = xlsxBuffer([
      COLES_HEADER,
      colesRow("BRI9415", "1111111", 10),
      colesRow("BRI9415", "1111111", 99),
    ]);
    const parsed = parseQuoteFile(buf);

    // First price wins; the contradiction is surfaced rather than resolved silently.
    expect(parsed.lines.filter((l) => l.effectiveOn === "2026-04-07")).toHaveLength(1);
    expect(parsed.lines[0]!.price).toBe(10);
    expect(parsed.warnings.some((w) => /two different prices/.test(w.reason))).toBe(true);
  });

  it("handles overlapping date ranges across separate rows", () => {
    const buf = xlsxBuffer([
      COLES_HEADER,
      colesRow("BRI9415", "1111111", 10, "Checked", APR7, APR7 + 2),
      colesRow("BRI9415", "2222222", 20, "Checked", APR7 + 1, APR13),
    ]);
    const parsed = parseQuoteFile(buf);
    expect(parsed.periodStart).toBe("2026-04-07");
    expect(parsed.periodEnd).toBe("2026-04-13");
    expect(parsed.lines.filter((l) => l.articleNo === "1111111")).toHaveLength(3);
    expect(parsed.lines.filter((l) => l.articleNo === "2222222")).toHaveLength(6);
  });
});

// ========================================================= Woolworths

describe("Woolworths quote parsing", () => {
  function wow(rows: (string | number | null)[][]) {
    return parseQuoteFile(wowHtmlBuffer([...WOW_ROWS_BASE, ...rows]));
  }

  it("produces one line per dated price column", () => {
    const parsed = wow([
      [172659, "Papaya Red", "TROPICAL", 10, "Brisbane RDC", 2986, 27, 28, null, null, "QLD", "Approved", "Current"],
    ]);

    expect(parsed.retailer).toBe("woolworths");
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0]).toMatchObject({ effectiveOn: "2026-03-03", price: 27, dcCode: "2986" });
    expect(parsed.lines[1]).toMatchObject({ effectiveOn: "2026-03-04", price: 28 });
  });

  it("does not mistake the Quantity columns for prices", () => {
    // The quantity block repeats the same weekday headers. Reading those as
    // prices would silently compare an order price against a case count.
    const parsed = wow([
      [172659, "Papaya Red", "TROPICAL", 10, "Brisbane RDC", 2986, 27, 27, 500, 600, "QLD", "Approved", "Current"],
    ]);
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines.map((l) => l.price)).toEqual([27, 27]);
  });

  it("drops superseded version rows", () => {
    const parsed = wow([
      [172659, "Papaya Red", "TROPICAL", 10, "Brisbane RDC", 2986, 27, 27, null, null, "QLD", "Approved", "Current"],
      [172659, "Papaya Red", "TROPICAL", 10, "Brisbane RDC", 2986, 99, 99, null, null, "QLD", "Approved", "Superseded"],
    ]);
    expect(parsed.lines.every((l) => l.price === 27)).toBe(true);
    expect(parsed.warnings.some((w) => /superseded/.test(w.reason))).toBe(true);
  });

  it("marks a non-approved row as unapproved rather than dropping it", () => {
    const parsed = wow([
      [172659, "Papaya Red", "TROPICAL", 10, "Brisbane RDC", 2986, 27, 27, null, null, "QLD", "Pending", "Current"],
    ]);
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines.every((l) => l.approved === false)).toBe(true);
  });

  it("warns and skips a row with no article number", () => {
    const parsed = wow([
      [null, "Nameless", "TROPICAL", 10, "Brisbane RDC", 2986, 27, 27, null, null, "QLD", "Approved", "Current"],
      [172659, "Papaya Red", "TROPICAL", 10, "Brisbane RDC", 2986, 27, 27, null, null, "QLD", "Approved", "Current"],
    ]);
    expect(parsed.rowCount).toBe(1);
    expect(parsed.warnings.some((w) => w.reason === "no article number")).toBe(true);
  });
});

// ====================================================== failure modes

describe("unusable input", () => {
  it("rejects a file that is not a spreadsheet at all", () => {
    expect(() => parseQuoteFile(Buffer.from("just some text, not a table"), "notes.txt")).toThrow(
      QuoteParseError
    );
  });

  it("rejects a spreadsheet with recognisable headers but no data rows", () => {
    const buf = xlsxBuffer([COLES_HEADER]);
    expect(() => parseQuoteFile(buf, "empty.xlsx")).toThrow(/no usable quote lines/);
  });

  it("rejects a spreadsheet whose columns are unrecognised", () => {
    const buf = xlsxBuffer([["Invoice", "Amount"], ["INV-1", 100]]);
    expect(() => parseQuoteFile(buf, "invoices.xlsx")).toThrow(/could not tell which retailer/);
  });

  it("rejects an entirely empty workbook", () => {
    expect(() => parseQuoteFile(xlsxBuffer([]), "blank.xlsx")).toThrow(QuoteParseError);
  });

  it("rejects a truncated file", () => {
    const full = xlsxBuffer([COLES_HEADER, colesRow("BRI9415", "4246862", 42)]);
    const truncated = full.subarray(0, Math.floor(full.length / 2));
    expect(() => parseQuoteFile(truncated, "truncated.xlsx")).toThrow(QuoteParseError);
  });

  it("reads a real .xlsx that was merely renamed .xls", () => {
    // The Woolworths file is HTML-as-.xls, so .xls alone must not imply HTML.
    const buf = xlsxBuffer([COLES_HEADER, colesRow("BRI9415", "4246862", 42)]);
    const parsed = parseQuoteFile(buf, "quotes.xls");
    expect(parsed.retailer).toBe("coles");
    expect(parsed.lines).toHaveLength(7);
  });
});

// ============================================================ helpers

describe("date handling", () => {
  it("converts Excel serials without depending on the local timezone", () => {
    expect(toIsoDate(46119)).toBe("2026-04-07");
    expect(toIsoDate(46125)).toBe("2026-04-13");
    expect(toIsoDate(25569)).toBe("1970-01-01");
  });

  it("reads dd/mm/yyyy as Australian order", () => {
    expect(toIsoDate("03/03/2026")).toBe("2026-03-03");
    expect(toIsoDate("13/04/2026")).toBe("2026-04-13");
  });

  it("reads dd-MMM-yy", () => {
    expect(toIsoDate("07-Apr-26")).toBe("2026-04-07");
  });

  it("rejects impossible dates instead of rolling them over", () => {
    expect(toIsoDate("31/02/2026")).toBeNull();
    expect(toIsoDate("not a date")).toBeNull();
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate(0)).toBeNull();
  });

  it("parses a Woolworths weekday column header", () => {
    expect(parseWeekdayHeaderDate("Tuesday (03-Mar-26)")).toBe("2026-03-03");
    expect(parseWeekdayHeaderDate("Growing Region")).toBeNull();
    expect(parseWeekdayHeaderDate(null)).toBeNull();
  });

  it("enumerates an inclusive day range", () => {
    expect(eachDay("2026-04-07", "2026-04-09")).toEqual([
      "2026-04-07", "2026-04-08", "2026-04-09",
    ]);
    expect(eachDay("2026-04-07", "2026-04-07")).toEqual(["2026-04-07"]);
    expect(eachDay("2026-04-09", "2026-04-07")).toEqual([]);
  });

  it("spans a month boundary", () => {
    expect(eachDay("2026-02-27", "2026-03-02")).toEqual([
      "2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02",
    ]);
  });
});
