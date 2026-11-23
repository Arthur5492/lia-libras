// Read a CSV file of signs. The admin screen uses it to add many signs at once.
//
// The first line has the names of the columns:
//   name;video_url;is_dynamic;is_two_handed
// `name` and `video_url` are necessary. Each other column is a tag, named by its code or by its label. A tag value is
// 1, sim, true or x for yes, and 0, não, false or an empty cell for no. The delimiter is a comma or a semicolon
// (Excel in Portuguese saves a semicolon). A cell can be in double quotes, and "" inside it is one quote.

/** Split a CSV text into rows of cells. The delimiter comes from the first line. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export interface SignRow {
  /** The line in the file, counting the header as line 1. */
  line: number;
  name: string;
  video_url: string;
  tags: Record<string, boolean>;
}

export interface ParsedSigns {
  rows: SignRow[];
  /** Problems that stop the import of a line, or of the whole file. */
  errors: string[];
  /** Columns that are not a tag of the catalog. They are not imported. */
  ignoredColumns: string[];
}

const YES = new Set(["1", "true", "sim", "s", "x", "yes", "y", "verdadeiro"]);
const NO = new Set(["", "0", "false", "nao", "não", "n", "no", "falso"]);

/** A text without accents, in lower case, for a comparison. */
function plain(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/** `tags` is the tag schema of the catalog: the code of each tag and its label. */
export function parseSignsCsv(text: string, tags: Record<string, { label: string }>): ParsedSigns {
  const table = parseCsv(text).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (table.length === 0) return { rows: [], errors: ["O arquivo está vazio."], ignoredColumns: [] };

  const header = table[0].map(plain);
  const nameAt = header.findIndex((h) => h === "name" || h === "nome");
  const urlAt = header.findIndex((h) => h === "video_url" || h === "video" || h === "link");
  const errors: string[] = [];
  if (nameAt < 0) errors.push('Falta a coluna "name" na primeira linha.');
  if (urlAt < 0) errors.push('Falta a coluna "video_url" na primeira linha.');
  if (errors.length > 0) return { rows: [], errors, ignoredColumns: [] };

  const tagAt = new Map<string, number>();
  const ignoredColumns: string[] = [];
  table[0].forEach((title, index) => {
    if (index === nameAt || index === urlAt) return;
    const key = Object.keys(tags).find((code) => plain(code) === header[index] || plain(tags[code].label) === header[index]);
    if (key) tagAt.set(key, index);
    else ignoredColumns.push(title.trim());
  });

  const rows: SignRow[] = [];
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const name = (cells[nameAt] ?? "").trim();
    const video = (cells[urlAt] ?? "").trim();
    const problems: string[] = [];
    if (!name) problems.push("sem nome");
    if (!video.startsWith("https://")) problems.push("o link do vídeo precisa começar com https://");
    const values: Record<string, boolean> = {};
    for (const [key, at] of tagAt) {
      const value = plain(cells[at] ?? "");
      if (YES.has(value)) values[key] = true;
      else if (NO.has(value)) values[key] = false;
      else problems.push(`valor "${(cells[at] ?? "").trim()}" não vale para ${tags[key].label}`);
    }
    if (problems.length > 0) errors.push(`Linha ${line}: ${problems.join(", ")}.`);
    else rows.push({ line, name, video_url: video, tags: values });
  });
  return { rows, errors, ignoredColumns };
}
