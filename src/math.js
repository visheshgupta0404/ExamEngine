const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let renderer, loading;
export function needsMath(workspace) {
  const quizzes = [
    ...(workspace?.quizzes || []),
    ...(workspace?.attempts || []).map((a) => a.quiz).filter(Boolean),
  ];
  return quizzes.some((q) =>
    (q.questions || []).some((q) =>
      [q.text, ...(q.options || []), q.rubric].some(
        (value) => typeof value === "string" && /\$[^$]+\$/.test(value),
      ),
    ),
  );
}
export async function prepareMath(workspace) {
  if (renderer || !needsMath(workspace)) return true;
  try {
    loading ||= import("katex").then((module) => {
      renderer = module.default;
    });
    await loading;
    return true;
  } catch {
    loading = null;
    return false;
  }
}
export function renderEquation(expression, options) {
  return renderer
    ? renderer.renderToString(expression, options)
    : `<code>${escape(expression)}</code>`;
}
