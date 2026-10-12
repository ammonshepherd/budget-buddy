/**
 * A small CSV reader (RFC 4180): commas separate cells, double quotes wrap
 * cells that contain commas, quotes ("" inside quotes) or line breaks.
 * Spreadsheet exports from Excel, Numbers and Google Sheets all follow this.
 */

export interface CsvRow {
  /** 1-based line in the file where the row starts, for error messages. */
  line: number;
  cells: string[];
}

export class CsvError extends Error {}

/** Splits CSV text into rows of cells. Blank lines are skipped. */
export function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  const endRow = () => {
    cells.push(cell);
    if (cells.some((c) => c.trim() !== "")) rows.push({ line: rowLine, cells });
    cells = [];
    cell = "";
  };

  // Excel adds a byte-order mark to UTF-8 files; it is not part of the data.
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === "\n") line++;
        cell += char;
      }
    } else if (char === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      endRow();
      line++;
      rowLine = line;
    } else {
      cell += char;
    }
  }
  if (quoted) throw new CsvError(`Line ${rowLine}: a quoted cell is never closed`);
  endRow();
  return rows;
}
