import { describe, expect, test } from "vitest";
import { parseCsv, parseSignsCsv } from "../../src/csv";

const TAGS = { is_dynamic: { label: "Dinâmico" }, is_two_handed: { label: "Usa duas mãos" } };

describe("parseCsv", () => {
  test("a comma", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  test("a semicolon, as Excel in Portuguese saves it", () => {
    expect(parseCsv("a;b\r\n1;2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  test("the mark at the start of a file from Excel is removed", () => {
    expect(parseCsv("﻿a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  test("a cell in quotes can have the delimiter, a new line and a quote", () => {
    expect(parseCsv('a;b\n"x;y";"he said ""hi""\nbye"')).toEqual([["a", "b"], ["x;y", 'he said "hi"\nbye']]);
  });

  test("empty cells stay", () => {
    expect(parseCsv("a;b;c\n1;;3")).toEqual([["a", "b", "c"], ["1", "", "3"]]);
  });
});

describe("parseSignsCsv", () => {
  const csv = "name;video_url;is_dynamic;is_two_handed\nAmor;https://x.test/amor.mp4;1;0\nLetra A;https://x.test/a.mp4;;sim\n";

  test("the signs and their tags", () => {
    const result = parseSignsCsv(csv, TAGS);
    expect(result.errors).toEqual([]);
    expect(result.ignoredColumns).toEqual([]);
    expect(result.rows).toEqual([
      { line: 2, name: "Amor", video_url: "https://x.test/amor.mp4", tags: { is_dynamic: true, is_two_handed: false } },
      { line: 3, name: "Letra A", video_url: "https://x.test/a.mp4", tags: { is_dynamic: false, is_two_handed: true } },
    ]);
  });

  test("a tag column can use the label, and the names of the columns can be in Portuguese", () => {
    const result = parseSignsCsv("Nome,Link,Dinâmico\nAmor,https://x.test/a.mp4,sim", TAGS);
    expect(result.rows).toEqual([{ line: 2, name: "Amor", video_url: "https://x.test/a.mp4", tags: { is_dynamic: true } }]);
  });

  test("a column that is not a tag is ignored, and it is told", () => {
    const result = parseSignsCsv("name,video_url,notes\nAmor,https://x.test/a.mp4,hello", TAGS);
    expect(result.ignoredColumns).toEqual(["notes"]);
    expect(result.rows).toHaveLength(1);
  });

  test("a bad line is an error and the other lines still count", () => {
    const result = parseSignsCsv("name,video_url,is_dynamic\n,https://x.test/a.mp4,1\nCasa,http://x.test/c.mp4,1\nOk,https://x.test/o.mp4,talvez\nBom,https://x.test/b.mp4,1", TAGS);
    expect(result.rows.map((r) => r.name)).toEqual(["Bom"]);
    expect(result.errors).toHaveLength(3);
    expect(result.errors[0]).toContain("Linha 2");
    expect(result.errors[0]).toContain("sem nome");
    expect(result.errors[1]).toContain("https://");
    expect(result.errors[2]).toContain("talvez");
  });

  test("a file without the necessary columns", () => {
    expect(parseSignsCsv("a,b\n1,2", TAGS).errors).toHaveLength(2);
    expect(parseSignsCsv("", TAGS).errors).toEqual(["O arquivo está vazio."]);
  });

  test("empty lines are skipped", () => {
    const result = parseSignsCsv("name,video_url\n\nAmor,https://x.test/a.mp4\n\n", TAGS);
    expect(result.rows).toHaveLength(1);
  });
});
