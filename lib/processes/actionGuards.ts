/**
 * Which activity-log rows each undo button may act on. Both undo routes take
 * a process_actions row id from the browser, and the table holds rows from
 * BOTH processes — so each route must check the row is its own kind before
 * writing to FreshTrack. Without this, the consignor "Unassign" route given a
 * marketer-fill row id would clear that order's consignor, which this tool
 * never set (e.g. the MACKM consignor on Brisbane POs).
 */

export interface ActionRowLike {
  process_key: string;
  action: string;
  status: string;
  after?: Record<string, unknown> | null;
}

export function canUnassignConsignor(row: ActionRowLike): boolean {
  return (
    row.process_key === "consignor_auto_assign" &&
    row.action === "set_consignor" &&
    row.status === "applied"
  );
}

export function canUndoMarketerFill(row: ActionRowLike): boolean {
  return (
    row.process_key === "marketer_auto_fill" &&
    row.action === "set_marketer" &&
    row.status === "applied" &&
    typeof row.after?.marketer_ft_id === "string" &&
    row.after.marketer_ft_id.length > 0
  );
}
