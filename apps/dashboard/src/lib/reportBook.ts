import ExcelJS from "exceljs";

/**
 * The Reports download: a workbook that reads well in Excel and Google Sheets.
 * The page loads this module (and ExcelJS with it) only when someone presses
 * Download, so the dashboard itself stays light.
 */

export type MeasureFormat = "count" | "money" | "percent";

export interface ReportMeasure {
  readonly key: string;
  readonly label: string;
  readonly format: MeasureFormat;
  /** Which way is good news, for colouring the change. */
  readonly better: "up" | "down";
}

export interface ReportDay {
  /** yyyy-mm-dd, Kigali. */
  readonly day: string;
  /** Percentages as fractions (0.83 for 83%). */
  readonly values: Readonly<Record<string, number>>;
}

// Nova's colours, as Excel writes them (alpha first).
const MIDNIGHT = "FF0A2342";
const YELLOW = "FFF4C20D";
const WHITE = "FFFFFFFF";
const MIST = "FFB4C0D3";
const INK = "FF1F2937";
const MUTED = "FF5F6B7A";
const STRIPE = "FFF5F7FA";
const LINE = "FFE5E7EB";
const GOOD = "FF15803D";
const BAD = "FFB91C1C";
// Arial looks the same in Excel and Google Sheets.
const FONT = "Arial";

const FORMAT: Record<MeasureFormat, string> = { count: "#,##0", money: '#,##0 "RWF"', percent: "0%" };
const CHANGE: Record<MeasureFormat, string> = {
  count: "+#,##0;-#,##0;0",
  money: '+#,##0 "RWF";-#,##0 "RWF";0 "RWF"',
  percent: "+0%;-0%;0%",
};

const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const longDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const shortDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const madeAt = () =>
  new Date().toLocaleString("en-GB", { timeZone: "Africa/Kigali", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Title, date and the yellow rule across the first `span` columns; returns the heading row. */
function topOf(ws: ExcelJS.Worksheet, span: number, title: string, subtitle: string): number {
  const across = (row: number) => ws.mergeCells(row, 1, row, span);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { name: FONT, size: 18, bold: true, color: { argb: WHITE } };
  t.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(1).height = 38;
  const s = ws.getCell(2, 1);
  s.value = subtitle;
  s.font = { name: FONT, size: 11, color: { argb: MIST } };
  s.alignment = { vertical: "top", indent: 1 };
  ws.getRow(2).height = 24;
  for (let c = 1; c <= span; c++) {
    ws.getCell(1, c).fill = fill(MIDNIGHT);
    ws.getCell(2, c).fill = fill(MIDNIGHT);
    ws.getCell(3, c).fill = fill(YELLOW);
  }
  across(1);
  across(2);
  ws.getRow(3).height = 5;
  ws.getRow(4).height = 10;
  return 5;
}

/** A heading row: white on midnight, the chosen day's column in yellow. */
function headingRow(ws: ExcelJS.Worksheet, row: number, labels: string[], yellow: number) {
  const r = ws.getRow(row);
  r.height = 28;
  labels.forEach((label, i) => {
    const cell = r.getCell(i + 1);
    const lit = i + 1 === yellow;
    cell.value = label;
    cell.font = { name: FONT, size: 11, bold: true, color: { argb: lit ? MIDNIGHT : WHITE } };
    cell.fill = fill(lit ? YELLOW : MIDNIGHT);
    cell.alignment = { vertical: "middle", horizontal: i === 0 ? "left" : "right", indent: 1 };
  });
}

/** One measure's row: striped, hairline below, numbers right-aligned in their format, the chosen day's column (`bold`) in bold. */
function bodyRow(ws: ExcelJS.Worksheet, row: number, label: string, numbers: { value: number; numFmt: string; color?: string }[], striped: boolean, bold: number) {
  const r = ws.getRow(row);
  r.height = 24;
  const cells = [{ value: label as string | number, numFmt: undefined as string | undefined, color: INK }, ...numbers];
  cells.forEach((c, i) => {
    const cell = r.getCell(i + 1);
    cell.value = c.value;
    if (c.numFmt) cell.numFmt = c.numFmt;
    cell.font = { name: FONT, size: 11, bold: i + 1 === bold, color: { argb: c.color ?? INK } };
    cell.alignment = { vertical: "middle", horizontal: i === 0 ? "left" : "right", indent: 1 };
    cell.fill = fill(striped ? STRIPE : WHITE);
    cell.border = { bottom: { style: "thin", color: { argb: LINE } } };
  });
}

function footer(ws: ExcelJS.Worksheet, row: number, span: number) {
  const cell = ws.getCell(row, 1);
  cell.value = `Downloaded ${madeAt()} (Kigali time) from Nova Control centre.`;
  cell.font = { name: FONT, size: 9, italic: true, color: { argb: MUTED } };
  ws.mergeCells(row, 1, row, span);
}

function printWide(ws: ExcelJS.Worksheet) {
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
}

/**
 * The workbook for the last of `days` (the chosen day), against the day before
 * on the first sheet and across the whole week on the second.
 */
export async function reportWorkbook(days: readonly ReportDay[], measures: readonly ReportMeasure[]): Promise<Blob> {
  const today = days[days.length - 1]!;
  const before = days[days.length - 2];
  const wb = new ExcelJS.Workbook();
  wb.creator = "Nova Control centre";
  wb.created = new Date();

  // ---- the day, against the day before ----
  const ws = wb.addWorksheet("Day", { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 40 }, { width: 18 }, { width: 18 }, { width: 16 }];
  const head = topOf(ws, 4, "Nova daily report", `${longDay(today.day)}, Kigali time`);
  headingRow(ws, head, ["Measure", "This day", "Day before", "Change"], 2);
  measures.forEach((m, i) => {
    const now = today.values[m.key] ?? 0;
    const then = before?.values[m.key] ?? 0;
    const change = now - then;
    const good = change === 0 ? MUTED : (change > 0) === (m.better === "up") ? GOOD : BAD;
    bodyRow(
      ws,
      head + 1 + i,
      m.label,
      [
        { value: now, numFmt: FORMAT[m.format] },
        { value: then, numFmt: FORMAT[m.format], color: MUTED },
        { value: change, numFmt: CHANGE[m.format], color: good },
      ],
      i % 2 === 1,
      2,
    );
  });
  footer(ws, head + measures.length + 2, 4);
  ws.views = [{ state: "frozen", ySplit: head, showGridLines: false }];
  printWide(ws);

  // ---- the week, a day to a column ----
  const wk = wb.addWorksheet("Last 7 days", { views: [{ showGridLines: false }] });
  const span = days.length + 1;
  wk.columns = [{ width: 40 }, ...days.map(() => ({ width: 15 }))];
  const wHead = topOf(wk, span, "Nova: the last 7 days", `${longDay(days[0]!.day)} to ${longDay(today.day)}, Kigali time`);
  headingRow(wk, wHead, ["Measure", ...days.map((d) => shortDay(d.day))], span);
  measures.forEach((m, i) => {
    bodyRow(
      wk,
      wHead + 1 + i,
      m.label,
      days.map((d, j) => ({ value: d.values[m.key] ?? 0, numFmt: FORMAT[m.format], color: j === days.length - 1 ? INK : MUTED })),
      i % 2 === 1,
      span,
    );
  });
  footer(wk, wHead + measures.length + 2, span);
  wk.views = [{ state: "frozen", xSplit: 1, ySplit: wHead, showGridLines: false }];
  printWide(wk);

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
