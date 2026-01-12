let ques = document.getElementById("ques");
let quizSubject = document.getElementById("quiz-subject");
let scoreContainer = document.getElementById("score");
let ScoreBox  = document.getElementById("ScoreTime");
let TimeBox =document.getElementById("Timer")
let score = 0;
let Timer = document.getElementById("leftTime");

quizSubject.innerText = "Frontend Web Basics";
const questions = [
  {
    ques: "Ques. Which HTML tag is used to define a table row?",
    options: [
      "1. <td> table data tag",
      "2. <tr> table row tag",
      "3. <row> table row tag",
      "4. <th> table head tag",
    ],
    correctOption: 1,
  },
  {
    ques: "Ques. Which HTML attribute provides alternate text for images?",
    options: [
      "1. src attribute text",
      "2. name attribute text",
      "3. alt attribute text",
      "4. title attribute text",
    ],
    correctOption: 2,
  },
  {
    ques: "Ques. Which HTML tag is used to create an ordered list?",
    options: [
      "1. <li> list item",
      "2. <dl> description list",
      "3. <ol> ordered list",
      "4. <ul> unordered list",
    ],
    correctOption: 2,
  },
  {
    ques: "Ques. Which CSS property controls the size of text?",
    options: [
      "1. font-style property",
      "2. font-size property",
      "3. text-style property",
      "4. text-size property",
    ],
    correctOption: 1,
  },
  {
    ques: "Ques. Which CSS property is used to make text bold?",
    options: [
      "1. font-style property",
      "2. text-weight property",
      "3. text-bold property",
      "4. font-weight property",
    ],
    correctOption: 3,
  },
  {
    ques: "Ques. Which CSS layout model allows flexible alignment?",
    options: [
      "1. table layout model",
      "2. inline layout model",
      "3. flexbox layout model",
      "4. float layout model",
    ],
    correctOption: 2,
  },
  {
    ques: "Ques. Which JavaScript function displays a message box?",
    options: [
      "1. message display function",
      "2. alert message function",
      "3. console.log function",
      "4. prompt dialog function",
    ],
    correctOption: 1,
  },
  {
    ques: "Ques. Which JavaScript operator compares value and type?",
    options: [
      "1. = assignment operator",
      "2. != inequality operator",
      "3. === strict equality operator",
      "4. == equality operator",
    ],
    correctOption: 2,
  },
  {
    ques: "Ques. Which JavaScript loop executes at least once?",
    options: [
      "1. while loop statement",
      "2. foreach loop statement",
      "3. do while loop statement",
      "4. for loop statement",
    ],
    correctOption: 2,
  },
  {
    ques: "Ques. Which JavaScript method converts JSON to object?",
    options: [
      "1. parseJSON method",
      "2. JSON.stringify method",
      "3. JSON.parse method",
      "4. object.parse method",
    ],
    correctOption: 2,
  },
];


let totalTime = 5;
let timeleft;
let timerCount;

function checkTime() {
  clearInterval(timerCount);
  timeleft = totalTime;
  Timer.innerText = timeleft;

  timerCount = setInterval(() => {
    timeleft--;
    Timer.innerText = timeleft;

    if (timeleft === 0) {
      clearInterval(timerCount);
      answered = true;
      questionNumber++;
      setTimeout(() => {
        QuestionMaker(questionNumber);
      }, 500);
    }
  }, 1000);
}

function checkOption(selectedOption, givenOption) {
  if (answered) return;
  answered = true;
  clearInterval(timerCount);

  let correctAnswer = givenOption.options[givenOption.correctOption];
  if (correctAnswer === selectedOption.innerText) {
    selectedOption.classList.add("correct");
    score += 5;
  } else {
    selectedOption.classList.add("wrong");
  }

  answered = true;
  scoreContainer.innerText = score;
  questionNumber++;

  setTimeout(() => {
    QuestionMaker(questionNumber);
  }, 500);
}
clearInterval(timerCount);
function setOptions(opt) {
  for (let i = 0; i < opt.options.length; i++) {
    let div = document.createElement("div");
    div.innerText = opt.options[i];
    div.classList.add("option");

    div.addEventListener("click", () => {
      checkOption(div, opt);
    });
    ques.append(div);
  }
}

function setQuestion(question) {
  let div = document.createElement("div");
  div.classList.add("ques");
  div.innerText = question.ques;
  ques.append(div);
}

function QuestionMaker(i) {
  if (i < questions.length) {
    ques.innerHTML = "";
    answered = false;
    setQuestion(questions[i]);
    setOptions(questions[i]);
    checkTime();
  } else {
    clearInterval(timerCount);
    Timer.innerText = "0";
    ScoreBox.innerText=`Final Score : ${score}`;
    TimeBox.innerText ="Time Over";
    if (score <= questions.length * 1.5) {
      
      ques.innerHTML = `<div class = "result">
      <h1>Your exam is over</h1>
        <h1>OOPs you <span id="PassFail">FAIL </span>the exam.</h1>
        <h1>You need to study well</h1>
        </div>`;
    } else {
      ques.innerHTML = `<div class = "result">
        <h1>Your exam is over</h1>
        <h1>Congratulations you <span id="PassFail">PASS </span>the exam </h1>
        </div>`;
    }
  }
}
let questionNumber = 0;
let answered = false;
function start() {
  scoreContainer.innerText = score;
  QuestionMaker(questionNumber);
}
start();
