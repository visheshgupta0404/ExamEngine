import test from "node:test";
import assert from "node:assert/strict";
import { importQuestions, parseCSV, questionTemplate } from "../src/import.js";
import {
  writeDraft,
  readDraft,
  removeDraft,
  clearEditorDrafts,
} from "../src/drafts.js";
import { paginate, searchItems } from "../src/lists.js";
function storage() {
  const m = new Map();
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i],
    getItem: (k) => m.get(k) || null,
    setItem: (k, v) => m.set(k, v),
    removeItem: (k) => m.delete(k),
  };
}
test("question template imports all three types with fresh IDs and correct selections", () => {
  let i = 0;
  const questions = importQuestions(questionTemplate, () => String(++i));
  assert.equal(questions.length, 3);
  assert.equal(questions[0].correctOption, 1);
  assert.deepEqual(questions[1].correctOptions, [0, 2]);
  assert.equal(questions[2].type, "written");
  assert.equal(new Set(questions.map((q) => q.id)).size, 3);
});
test("CSV handles quoted commas, multiline text, escaped quotes and BOM", () => {
  assert.deepEqual(parseCSV('\uFEFFa,b\r\n"one,two","line\nwith ""quotes"""'), [
    ["a", "b"],
    ["one,two", 'line\nwith "quotes"'],
  ]);
  for (const text of ['a,"bad', 'a,"ok"bad', 'a,b"c'])
    assert.throws(() => parseCSV(text));
});
test("question import rejects invalid answers, gaps, types, excess rows and oversized files atomically", () => {
  const header = questionTemplate.split("\r\n")[0];
  for (const row of [
    "single,Q,A,B,,,,,C,",
    "multiple,Q,A,B,,,,,A;A,",
    "single,Q,A,B,,,,,A;B,",
    "written,Q,A,,,,,,,",
    "other,Q,A,B,,,,,A,",
    "single,Q,A,,C,,,,A,",
  ])
    assert.throws(() => importQuestions(header + "\n" + row));
  assert.throws(() =>
    importQuestions(
      header + "\n" + Array(101).fill("single,Q,A,B,,,,,A,").join("\n"),
    ),
  );
  assert.throws(() => importQuestions("x".repeat(2_000_001)));
});
test("recovery retains unfinished raw fields but isolates identity and route and expires", () => {
  const s = storage(),
    q = {
      id: "draft",
      questions: [{ id: "q", imagePath: "private/image", image: "signed-url" }],
    },
    fields = [
      ["title", "Unfinished"],
      ["roster", "partial@"],
    ];
  writeDraft(s, "prof:college", "new", q, fields, 1000);
  assert.deepEqual(readDraft(s, "prof:college", "new", 1001).fields, fields);
  assert.equal(readDraft(s, "other:college", "new", 1001), null);
  assert.equal(readDraft(s, "prof:college", "saved-id", 1001), null);
  assert.equal(readDraft(s, "prof:college", "new", 86401001), null);
  assert.equal(
    readDraft(s, "prof:college", "new", 1001).editor.questions[0].image,
    undefined,
  );
  removeDraft(s, "prof:college", "new");
  assert.equal(s.length, 0);
});
test("sign-out removes recovery copies without touching unrelated session data", () => {
  const s = storage();
  writeDraft(s, "a", "new", { questions: [{}] }, []);
  writeDraft(s, "b", "new", { questions: [{}] }, []);
  s.setItem("unrelated", "keep");
  clearEditorDrafts(s);
  assert.equal(s.length, 1);
  assert.equal(s.getItem("unrelated"), "keep");
});
test("list pagination clamps after filtering and searches without changing source data", () => {
  const rows = Array.from({ length: 105 }, (_, i) => ({
    name: "Student " + i,
    className: i % 2 ? "A" : "B",
  }));
  assert.equal(paginate(rows, 1).items.length, 20);
  assert.equal(paginate(rows, 99).page, 6);
  assert.equal(paginate(rows, 6).items.length, 5);
  const filtered = searchItems(
    rows,
    "student 104 B",
    (r) => r.name + " " + r.className,
  );
  assert.equal(filtered.length, 1);
  assert.equal(paginate(filtered, 6).page, 1);
  assert.equal(rows.length, 105);
  assert.equal(paginate([]).start, 0);
});
