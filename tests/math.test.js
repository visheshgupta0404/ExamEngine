import test from "node:test";
import assert from "node:assert/strict";
import { needsMath, prepareMath, renderEquation } from "../src/math.js";
test("equation engine loads only when authorized question content needs it", async () => {
  assert.equal(needsMath({ quizzes: [{ questions: [] }] }), false);
  assert.equal(
    needsMath({
      quizzes: [{ questions: [{ text: "Plain text", options: ["A", "B"] }] }],
    }),
    false,
  );
  assert.equal(
    needsMath({
      attempts: [{ quiz: { questions: [{ text: "Compute $x^2$" }] } }],
    }),
    true,
  );
  assert.equal(
    needsMath({
      quizzes: [{ questions: [{ text: "Question", options: ["$1$", "2"] }] }],
    }),
    true,
  );
  assert.match(renderEquation("<img onerror=alert(1)>", {}), /&lt;img/);
  assert.equal(
    await prepareMath({ quizzes: [{ questions: [{ text: "$x^2$" }] }] }),
    true,
  );
  const html = renderEquation("x^2", { throwOnError: false, trust: false });
  assert.match(html, /katex/);
  assert.match(html, /<math/);
});
