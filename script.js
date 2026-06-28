const TOTAL_QUESTIONS = 10;
const FEEDBACK_DELAY = 2000;
const QUESTION_TIME = 15;

const questionPool = [
  {
    question: "Qual é a principal função do sistema reprodutor humano?",
    options: ["Produzir apenas hormônios de crescimento.", "Permitir a reprodução da espécie e a produção de gametas.", "Filtrar o sangue e eliminar a urina do corpo.", "Bombear sangue para todos os órgãos do corpo."],
    answer: "Permitir a reprodução da espécie e a produção de gametas."
  },
  {
    question: "Quais são os hormônios produzidos pelo sistema reprodutor feminino?",
    options: ["Testosterona e Insulina.", "Estrogênio e Progesterona.", "Adrenalina e Cortisol.", "Frutose e Sêmen."],
    answer: "Estrogênio e Progesterona."
  },
  {
    question: "Quais são as duas funções principais dos ovários?",
    options: ["Produzir óvulos e os hormônios estrogênio e progesterona.", "Guardar o bebê e produzir urina.", "Transportar os espermatozoides até o útero.", "Produzir testosterona e sêmen."],
    answer: "Produzir óvulos e os hormônios estrogênio e progesterona."
  },
  {
    question: "Em qual local do sistema reprodutor feminino normalmente acontece a fecundação?",
    options: ["Na Vagina.", "No Útero.", "Nas Tubas Uterinas.", "Nos Ovários."],
    answer: "Nas Tubas Uterinas."
  },
  {
    question: "Qual é o órgão muscular, com formato de pera invertida, onde o embrião se fixa na gravidez?",
    options: ["Útero.", "Vagina.", "Colo do Útero.", "Epidídimo."],
    answer: "Útero."
  },
  {
    question: "Como se chama o revestimento interno do útero que é eliminado durante a menstruação se não houver fecundação?",
    options: ["Cervix.", "Pelvis.", "Endométrio.", "Bolsa Escrotal."],
    answer: "Endométrio."
  },
  {
    question: "Qual órgão faz a ligação entre o útero e a vagina, permanecendo fechado na gravidez e dilatando no parto?",
    options: ["Tuba uterina.", "Ovário.", "Canal deferente.", "Colo do útero (cervix)."],
    answer: "Colo do útero (cervix)."
  },
  {
    question: "Qual das alternativas abaixo NÃO é uma função da vagina citada no texto?",
    options: ["Receber o pênis durante a relação sexual.", "Produzir os óvulos e os hormônios femininos.", "Permitir a saída da menstruação.", "Servir como canal de parto."],
    answer: "Produzir os óvulos e os hormônios femininos."
  },
  {
    question: "Qual é o principal hormônio sexual masculino produzido pelos testículos?",
    options: ["Estrogênio.", "Progesterona.", "Testosterona.", "Frutose."],
    answer: "Testosterona."
  },
  {
    question: "Onde ficam localizados os testículos no corpo masculino?",
    options: ["Dentro da próstata.", "Dentro da bolsa escrotal.", "Nas tubas uterinas.", "No canal deferente."],
    answer: "Dentro da bolsa escrotal."
  },
  {
    question: "Qual é a função do epidídimo?",
    options: ["Eliminar a urina para o meio externo.", "Produzir um líquido rico em frutose.", "Armazenar os espermatozoides e permitir que eles amadureçam.", "Fixar o embrião na parede uterina."],
    answer: "Armazenar os espermatozoides e permitir que eles amadureçam."
  },
  {
    question: "Qual canal faz a conexão do epidídimo até a uretra para transportar os espermatozoides na ejaculação?",
    options: ["Canal Deferente.", "Tuba Uterina.", "Uretra.", "Vagina."],
    answer: "Canal Deferente."
  },
  {
    question: "As vesículas seminais produzem um líquido rico em qual nutriente para dar energia aos espermatozoides?",
    options: ["Glicose.", "Frutose.", "Lactose.", "Proteína."],
    answer: "Frutose."
  },
  {
    question: "Qual glândula produz o líquido transparente antes da ejaculação para lubrificar e neutralizar a acidez da uretra?",
    options: ["Próstata.", "Ovários.", "Glândulas bulboretrais.", "Vesículas seminais."],
    answer: "Glândulas bulboretrais."
  },
  {
    question: "Sobre o pênis, qual regra importante sobre a uretra foi mencionada no trabalho?",
    options: ["Ele produz óvulos e espermatozoides juntos.", "A urina e o sêmen nunca passam ao mesmo tempo pela uretra.", "Ele armazena o embrião durante toda a gestação.", "Ele serve apenas para o sistema urinário."],
    answer: "A urina e o sêmen nunca passam ao mesmo tempo pela uretra."
  }
];

const screens = {
  menu: document.querySelector("#menu-screen"),
  game: document.querySelector("#game-screen"),
  result: document.querySelector("#result-screen")
};

const startButton = document.querySelector("#start-button");
const restartButton = document.querySelector("#restart-button");
const progressFill = document.querySelector("#progress-fill");
const questionCounter = document.querySelector("#question-counter");
const timerText = document.querySelector("#timer-text");
const questionText = document.querySelector("#question-text");
const answersGrid = document.querySelector("#answers-grid");
const scoreText = document.querySelector("#score-text");
const percentageText = document.querySelector("#percentage-text");
const percentageRing = document.querySelector(".percentage-ring");
const feedbackText = document.querySelector("#feedback-text");
const successImage = document.querySelector("#success-image");

let currentQuestions = [];
let currentIndex = 0;
let score = 0;
let isLocked = false;
let timeLeft = QUESTION_TIME;
let timerId = null;
let audioContext = null;
let musicTimerId = null;

function shuffleArray(array) {
  const copy = [...array];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }

  return copy;
}

function showScreen(screenName) {
  Object.values(screens).forEach((screen) => screen.classList.remove("screen-active"));
  screens[screenName].classList.add("screen-active");
}

function startGame() {
  initAudio();
  startMusic();
  playStartSound();
  stopTimer();
  currentQuestions = shuffleArray(questionPool).slice(0, TOTAL_QUESTIONS).map((item) => ({
    ...item,
    options: [...item.options]
  }));
  currentIndex = 0;
  score = 0;
  isLocked = false;
  showScreen("game");
  renderQuestion();
}

function renderQuestion() {
  const currentQuestion = currentQuestions[currentIndex];
  const progressPercentage = (currentIndex / TOTAL_QUESTIONS) * 100;

  stopTimer();
  progressFill.style.width = `${progressPercentage}%`;
  questionCounter.textContent = `Questão ${currentIndex + 1} de ${TOTAL_QUESTIONS}`;
  questionText.textContent = currentQuestion.question;
  answersGrid.innerHTML = "";
  isLocked = false;
  startTimer();

  currentQuestion.options.forEach((option, index) => {
    const button = document.createElement("button");
    const icon = document.createElement("span");
    const text = document.createElement("span");

    button.type = "button";
    button.className = `answer-button option-${index}`;
    button.dataset.answer = option;
    button.setAttribute("aria-label", `Alternativa ${index + 1}: ${option}`);

    icon.className = "shape-icon";
    icon.setAttribute("aria-hidden", "true");

    text.className = "answer-text";
    text.textContent = option;

    button.append(icon, text);
    button.addEventListener("click", () => handleAnswer(button, currentQuestion.answer));
    answersGrid.appendChild(button);
  });
}

function handleAnswer(selectedButton, correctAnswer) {
  if (isLocked) {
    return;
  }

  isLocked = true;
  stopTimer();
  const buttons = [...answersGrid.querySelectorAll(".answer-button")];
  const selectedAnswer = selectedButton.dataset.answer;
  const isCorrect = selectedAnswer === correctAnswer;

  if (isCorrect) {
    score += 1;
    selectedButton.classList.add("correct");
    playCorrectSound();
  } else {
    selectedButton.classList.add("wrong");
    playWrongSound();
  }

  revealAnswer(correctAnswer, selectedButton);
  scheduleNextQuestion();
}

function handleTimeout() {
  if (isLocked) {
    return;
  }

  isLocked = true;
  stopTimer();
  playTimeoutSound();
  revealAnswer(currentQuestions[currentIndex].answer);
  scheduleNextQuestion();
}

function revealAnswer(correctAnswer, selectedButton = null) {
  const buttons = [...answersGrid.querySelectorAll(".answer-button")];

  buttons.forEach((button) => {
    button.disabled = true;

    if (button.dataset.answer === correctAnswer) {
      button.classList.add("correct");
    } else if (button !== selectedButton) {
      button.classList.add("dimmed");
    }
  });
}

function scheduleNextQuestion() {
  window.setTimeout(() => {
    currentIndex += 1;

    if (currentIndex < TOTAL_QUESTIONS) {
      renderQuestion();
    } else {
      showResults();
    }
  }, FEEDBACK_DELAY);
}

function showResults() {
  stopTimer();
  stopMusic();
  playFinishSound();
  const percentage = Math.round((score / TOTAL_QUESTIONS) * 100);

  progressFill.style.width = "100%";
  scoreText.textContent = `Você acertou ${score} de ${TOTAL_QUESTIONS}!`;
  percentageText.textContent = `${percentage}%`;
  percentageRing.style.setProperty("--score-angle", `${percentage * 3.6}deg`);
  feedbackText.textContent = getFeedbackMessage(percentage);
  successImage.hidden = score <= 7;
  showScreen("result");
}

function startTimer() {
  timeLeft = QUESTION_TIME;
  updateTimer();

  timerId = window.setInterval(() => {
    timeLeft -= 1;
    updateTimer();

    if (timeLeft <= 3 && timeLeft > 0) {
      playTickSound();
    }

    if (timeLeft <= 0) {
      handleTimeout();
    }
  }, 1000);
}

function stopTimer() {
  if (timerId !== null) {
    window.clearInterval(timerId);
    timerId = null;
  }
}

function updateTimer() {
  timerText.textContent = `${timeLeft}s`;
  timerText.parentElement.classList.toggle("timer-warning", timeLeft <= 5);
}

function initAudio() {
  if (audioContext) {
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    return;
  }

  audioContext = new AudioContextClass();
}

function playTone(frequency, duration = 0.16, type = "sine", volume = 0.12, delay = 0) {
  if (!audioContext) {
    return;
  }

  const startTime = audioContext.currentTime + delay;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startTime);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.03);
}

function playStartSound() {
  playTone(440, 0.12, "triangle", 0.1);
  playTone(660, 0.16, "triangle", 0.1, 0.1);
}

function playCorrectSound() {
  playTone(620, 0.12, "sine", 0.12);
  playTone(830, 0.18, "sine", 0.12, 0.1);
}

function playWrongSound() {
  playTone(180, 0.2, "sawtooth", 0.08);
  playTone(130, 0.22, "sawtooth", 0.07, 0.13);
}

function playTimeoutSound() {
  playTone(260, 0.18, "square", 0.08);
  playTone(220, 0.18, "square", 0.08, 0.18);
}

function playTickSound() {
  playTone(720, 0.06, "square", 0.05);
}

function playFinishSound() {
  playTone(520, 0.14, "triangle", 0.1);
  playTone(660, 0.14, "triangle", 0.1, 0.12);
  playTone(780, 0.24, "triangle", 0.1, 0.24);
}

function startMusic() {
  if (!audioContext || musicTimerId !== null) {
    return;
  }

  const notes = [196, 247, 294, 247, 220, 262, 330, 262];
  let noteIndex = 0;

  musicTimerId = window.setInterval(() => {
    playTone(notes[noteIndex], 0.28, "triangle", 0.025);
    noteIndex = (noteIndex + 1) % notes.length;
  }, 520);
}

function stopMusic() {
  if (musicTimerId !== null) {
    window.clearInterval(musicTimerId);
    musicTimerId = null;
  }
}

function getFeedbackMessage(percentage) {
  if (percentage >= 90) {
    return "Excelente! Você domina os conceitos essenciais do sistema reprodutor humano.";
  }

  if (percentage >= 70) {
    return "Muito bom! Você tem uma base forte e só precisa revisar alguns detalhes.";
  }

  if (percentage >= 50) {
    return "Bom esforço! Revise gametas, fecundação, puberdade e hormônios para melhorar ainda mais.";
  }

  return "Continue estudando com calma. Cada tentativa ajuda a fixar os conceitos principais.";
}

startButton.addEventListener("click", startGame);
restartButton.addEventListener("click", startGame);
