/** Escape one CSV cell (RFC4180 style). */
export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build CSV text from a matrix of cells. */
export function toCsv(rows: unknown[][], opts: { bom?: boolean; eol?: string } = {}): string {
  const eol = opts.eol ?? "\n";
  const body = rows.map((row) => row.map(csvCell).join(",")).join(eol);
  return opts.bom === false ? body : `\uFEFF${body}`;
}

/** Parse CSV text, including quoted commas, quotes and newlines. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** CSV download response with the same headers used across Atlas exports. */
export function csvResponse(filename: string, csv: string): Response {
  const body = csv.startsWith("\uFEFF") ? csv : `\uFEFF${csv}`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
