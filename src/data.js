export const sampleQuestions = [
  [
    "Which HTML tag defines a table row?",
    ["<td>", "<tr>", "<table>", "<th>"],
    1,
  ],
  [
    "Which HTML attribute provides alternative text for an image?",
    ["src", "title", "alt", "href"],
    2,
  ],
  [
    "Which HTML tag creates an ordered list?",
    ["<ul>", "<dl>", "<ol>", "<li>"],
    2,
  ],
  [
    "Which CSS property controls text size?",
    ["font-style", "font-size", "text-style", "text-size"],
    1,
  ],
  [
    "Which CSS property makes text bold?",
    ["font-style", "text-weight", "text-bold", "font-weight"],
    3,
  ],
  [
    "Which CSS layout model supports flexible alignment?",
    ["table layout", "inline layout", "flexbox", "float layout"],
    2,
  ],
  [
    "Which JavaScript function displays an alert dialog?",
    ["message()", "alert()", "console.log()", "prompt()"],
    1,
  ],
  [
    "Which JavaScript operator compares both value and type?",
    ["=", "!=", "===", "=="],
    2,
  ],
  [
    "Which JavaScript loop executes its body at least once?",
    ["while", "forEach", "do…while", "for"],
    2,
  ],
  [
    "Which JavaScript method parses a JSON string into an object?",
    ["parseJSON()", "JSON.stringify()", "JSON.parse()", "Object.parse()"],
    2,
  ],
].map(([text, options, correctOption], i) => ({
  id: `web-${i + 1}`,
  text,
  options,
  correctOption,
}));
export function seedData() {
  return {
    version: 1,
    colleges: [{ id: "bmu", name: "BMU", domains: ["bmu.edu.in"] }],
    professors: [
      {
        id: "prof-demo",
        name: "Sample professor",
        email: "professor@bmu.edu.in",
        collegeId: "bmu",
        status: "approved",
      },
    ],
    identity: {
      name: "Vishesh Gupta",
      roll: "",
      email: "",
      collegeId: "bmu",
      className: "CSE · 2024",
    },
    quizzes: [
      {
        id: "web-basics",
        title: "Frontend Web Fundamentals",
        subject: "Web development",
        description: "An assessment of HTML, CSS, and JavaScript fundamentals.",
        collegeId: "bmu",
        professorId: "prof-demo",
        className: "CSE · 2024",
        code: "WEB-101",
        duration: 10,
        marks: 1,
        penalty: 0,
        attemptLimit: 1,
        release: true,
        published: true,
        questions: sampleQuestions,
      },
    ],
    attempts: [],
  };
}
