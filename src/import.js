// Quoted CSV with escaped quotes and embedded newlines. No external parser/runtime.
export function parseCSV(text) {
  if (typeof text !== "string" || text.length > 2_000_000)
    throw new Error("Choose a CSV smaller than 2 MB.");
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [],
    field = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else field += c;
    } else if (c === '"') {
      if (field || closed) throw new Error("Unexpected quote in CSV.");
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
      closed = false;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      field = "";
      closed = false;
    } else {
      if (closed) throw new Error("Unexpected text after a quoted CSV value.");
      field += c;
    }
    if (rows.length > 101) throw new Error("Import at most 100 questions.");
  }
  if (quoted) throw new Error("CSV has an unclosed quote.");
  row.push(field);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
export function importQuestions(text, makeId = () => crypto.randomUUID()) {
  const [header, ...rows] = parseCSV(text);
  const columns = [
    "type",
    "question",
    "option_a",
    "option_b",
    "option_c",
    "option_d",
    "option_e",
    "option_f",
    "correct",
    "rubric",
  ];
  if (
    !header ||
    header.length !== columns.length ||
    header.some((v, i) => v.trim().toLowerCase() !== columns[i])
  )
    throw new Error(
      "Use the question CSV template and keep its column headings.",
    );
  if (!rows.length || rows.length > 100)
    throw new Error("Import between 1 and 100 questions.");
  return rows.map((row, i) => {
    const fail = (message) => {
      throw new Error(`Row ${i + 2}: ${message}`);
    };
    if (row.length !== columns.length) fail("expected 10 columns.");
    const [type, text, ...rest] = row.map((v) => v.trim());
    const options = rest.slice(0, 6),
      correct = rest[6],
      rubric = rest[7];
    if (!["single", "multiple", "written"].includes(type))
      fail("type must be single, multiple, or written.");
    if (!text || text.length > 4000)
      fail("question must contain 1-4000 characters.");
    if (rubric.length > 2000) fail("rubric must be at most 2000 characters.");
    const q = {
      id: makeId(),
      type,
      text,
      options: [],
      correctOption: 0,
      correctOptions: [],
      rubric,
      image: "",
      imageAlt: "",
    };
    if (type === "written") {
      if (options.some(Boolean) || correct)
        fail("written questions cannot have options or correct selections.");
      return q;
    }
    while (options.length && !options.at(-1)) options.pop();
    if (options.length < 2 || options.some((v) => !v || v.length > 1000))
      fail("use 2-6 consecutive options, at most 1000 characters each.");
    if (!/^[A-F](;[A-F])*$/.test(correct))
      fail(
        "correct must be A, B, etc.; separate multiple selections with semicolons.",
      );
    const indices = correct.split(";").map((v) => v.charCodeAt(0) - 65);
    if (
      new Set(indices).size !== indices.length ||
      indices.some((v) => v >= options.length) ||
      (type === "single" && indices.length !== 1)
    )
      fail("correct selections do not match the question options/type.");
    return {
      ...q,
      options,
      correctOption: indices[0],
      correctOptions: indices,
    };
  });
}
export const questionTemplate =
  "type,question,option_a,option_b,option_c,option_d,option_e,option_f,correct,rubric\r\nsingle,Which value equals two plus two?,3,4,5,,,,B,\r\nmultiple,Select even numbers.,2,3,4,,,,A;C,\r\nwritten,Explain your approach.,,,,,,,,Award marks for a clear explanation.\r\n";
