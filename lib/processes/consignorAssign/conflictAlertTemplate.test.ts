import { describe, it, expect } from "vitest";
import {
  buildConflictAlertSubject,
  renderConflictAlertHtml,
  type ConflictAlertModel,
} from "./conflictAlertTemplate";

function model(over: Partial<ConflictAlertModel> = {}): ConflictAlertModel {
  return {
    mode: "apply",
    detectedAt: "2026-08-01T15:00:00.000Z",
    items: [
      {
        orderRef: "5024318",
        consigneeName: "Coles Melbourne",
        reasonLabel: "Mixed crops, different consignors",
      },
    ],
    ...over,
  };
}

describe("buildConflictAlertSubject", () => {
  it("is singular for one order", () => {
    expect(buildConflictAlertSubject(model())).toBe(
      "Auto FT Consignor Update — action needed: 1 order blocked by a rule conflict"
    );
  });

  it("is plural for several", () => {
    const m = model({
      items: [
        { orderRef: "A", consigneeName: null, reasonLabel: "No matching rule" },
        { orderRef: "B", consigneeName: null, reasonLabel: "No matching rule" },
      ],
    });
    expect(buildConflictAlertSubject(m)).toContain("2 orders blocked");
  });
});

describe("renderConflictAlertHtml", () => {
  it("lists every conflicted order with its customer and reason", () => {
    const html = renderConflictAlertHtml(model());
    expect(html).toContain("5024318");
    expect(html).toContain("Coles Melbourne");
    expect(html).toContain("Mixed crops, different consignors");
  });

  it("renders an em dash when the customer is unknown", () => {
    const html = renderConflictAlertHtml(
      model({
        items: [{ orderRef: "X1", consigneeName: null, reasonLabel: "No matching rule" }],
      })
    );
    expect(html).toContain("—");
  });

  it("says nothing was written when the process is in dry run", () => {
    expect(renderConflictAlertHtml(model({ mode: "dry_run" }))).toContain("dry-run mode");
    expect(renderConflictAlertHtml(model({ mode: "apply" }))).toContain(
      "assigned as normal"
    );
  });

  it("explains that repeats are not re-sent, so the summary is the running total", () => {
    expect(renderConflictAlertHtml(model())).toContain("not re-sent");
  });

  it("escapes HTML in every interpolated field", () => {
    const html = renderConflictAlertHtml(
      model({
        items: [
          {
            orderRef: "<script>alert(1)</script>",
            consigneeName: "Tim & \"Co\"",
            reasonLabel: "<b>boom</b>",
          },
        ],
      })
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Tim &amp; &quot;Co&quot;");
    expect(html).toContain("&lt;b&gt;boom&lt;/b&gt;");
  });
});
