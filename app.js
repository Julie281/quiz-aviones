const MAX_TIME_SECONDS = 120;
const RANKING_LIMIT = 10;
const RANKING_STORAGE_KEY = "quizAvionesRanking";

const state = {
  aircraftDb: [],
  questions: [],
  currentIndex: 0,
  currentQuestion: null,
  score: 0,
  answered: 0,
  locked: false,
  playerName: "Anónimo",
  remainingTime: MAX_TIME_SECONDS,
  timerId: null,
  advanceTimeoutId: null,
  isLoaded: false,
  imageCache: new Map(),
  imageRequestToken: 0
};

const els = {
  startScreen: document.getElementById("startScreen"),
  quizScreen: document.getElementById("quizScreen"),
  resultScreen: document.getElementById("resultScreen"),
  startBtn: document.getElementById("startBtn"),
  playAgainBtn: document.getElementById("playAgainBtn"),
  restartBtn: document.getElementById("restartBtn"),
  playerName: document.getElementById("playerName"),
  mode: document.getElementById("mode"),
  progressText: document.getElementById("progressText"),
  scoreText: document.getElementById("scoreText"),
  timerText: document.getElementById("timerText"),
  questionTag: document.getElementById("questionTag"),
  questionText: document.getElementById("questionText"),
  answers: document.getElementById("answers"),
  feedback: document.getElementById("feedback"),
  nextBtn: document.getElementById("nextBtn"),
  finalScore: document.getElementById("finalScore"),
  finalMessage: document.getElementById("finalMessage"),
  rankingList: document.getElementById("rankingList"),
  imageWrap: document.getElementById("imageWrap"),
  planeImage: document.getElementById("planeImage"),
  imageFallback: document.getElementById("imageFallback"),
  loadingText: document.getElementById("loadingText")
};

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function formatNumber(value) {
  return new Intl.NumberFormat("es-ES").format(value);
}

function formatNm(value) {
  return `${formatNumber(value)} nm`;
}

function showScreen(screenName) {
  els.startScreen.classList.add("hidden");
  els.quizScreen.classList.add("hidden");
  els.resultScreen.classList.add("hidden");

  if (screenName === "start") els.startScreen.classList.remove("hidden");
  if (screenName === "quiz") els.quizScreen.classList.remove("hidden");
  if (screenName === "result") els.resultScreen.classList.remove("hidden");
}

function updateStats() {
  els.progressText.textContent = `Respondidas: ${state.answered}`;
  els.scoreText.textContent = `Aciertos: ${state.score}`;
}

function updateTimer() {
  els.timerText.textContent = `Tiempo: ${state.remainingTime}s`;
}

function stopTimer() {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

function clearAdvanceTimeout() {
  if (state.advanceTimeoutId) {
    clearTimeout(state.advanceTimeoutId);
    state.advanceTimeoutId = null;
  }
}

function startTimer() {
  stopTimer();
  state.remainingTime = MAX_TIME_SECONDS;
  updateTimer();

  state.timerId = setInterval(() => {
    state.remainingTime -= 1;
    updateTimer();

    if (state.remainingTime <= 0) {
      state.remainingTime = 0;
      updateTimer();
      stopTimer();
      clearAdvanceTimeout();
      showResults(true);
    }
  }, 1000);
}

function loadRanking() {
  try {
    return JSON.parse(localStorage.getItem(RANKING_STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveRanking(entry) {
  const ranking = loadRanking();
  ranking.push(entry);

  ranking.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;

    const accA = a.total > 0 ? a.score / a.total : 0;
    const accB = b.total > 0 ? b.score / b.total : 0;
    if (accB !== accA) return accB - accA;

    if (a.usedTime !== b.usedTime) return a.usedTime - b.usedTime;

    return new Date(b.date) - new Date(a.date);
  });

  localStorage.setItem(
    RANKING_STORAGE_KEY,
    JSON.stringify(ranking.slice(0, RANKING_LIMIT))
  );
}

function renderRanking() {
  const ranking = loadRanking();

  if (!ranking.length) {
    els.rankingList.innerHTML = "<li>No hay partidas guardadas todavía.</li>";
    return;
  }

  els.rankingList.innerHTML = ranking
    .map((item) => {
      const accuracy = item.total > 0 ? Math.round((item.score / item.total) * 100) : 0;

      return `
        <li>
          <strong>${item.name}</strong> — ${item.score} aciertos
          <div class="ranking-meta">
            Respondidas: ${item.total} · Precisión: ${accuracy}% · Tiempo: ${item.usedTime}s
          </div>
        </li>
      `;
    })
    .join("");
}

async function loadExternalDatabase() {
  const manifestRes = await fetch("./data/manifest.json");
  if (!manifestRes.ok) throw new Error("No se pudo cargar data/manifest.json");

  const manifest = await manifestRes.json();
  const allPaths = [...manifest.civil, ...manifest.military, ...manifest.prototypes];

  const datasets = await Promise.all(
    allPaths.map(async (path) => {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`No se pudo cargar ${path}`);
      return res.json();
    })
  );

  state.aircraftDb = datasets.flat();
}

function buildChoiceSet(correct, distractors = [], fallback = []) {
  const base = [correct];

  for (const item of [...distractors, ...fallback]) {
    if (item === null || item === undefined) continue;
    if (!base.includes(item)) base.push(item);
    if (base.length === 4) break;
  }

  while (base.length < 4) {
    const filler = `Opción ${base.length + 1}`;
    if (!base.includes(filler)) base.push(filler);
  }

  const options = shuffle(base);
  return { options, correctIndex: options.indexOf(correct) };
}

function getClosestNumbers(target, values, count = 3) {
  return [...new Set(values.filter((v) => typeof v === "number" && v !== target))]
    .sort((a, b) => Math.abs(a - target) - Math.abs(b - target))
    .slice(0, count);
}

function getUniqueValues(field) {
  return [...new Set(state.aircraftDb.map((x) => x[field]).filter(Boolean))];
}

function getSimilarAircraftNames(plane, count = 3) {
  const ranked = state.aircraftDb
    .filter((item) => item.id !== plane.id)
    .map((item) => {
      let score = 0;

      if (item.domain === plane.domain) score += 8;
      if (item.role === plane.role) score += 10;
      if (item.decade === plane.decade) score += 4;
      if (item.manufacturer === plane.manufacturer) score += 3;

      if (typeof item.engines === "number" && typeof plane.engines === "number") {
        score -= Math.abs(item.engines - plane.engines);
      }

      return { name: item.name, score };
    })
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, count).map((item) => item.name);
}

function buildAircraftQuestions(plane) {
  const questions = [];
  const domains = ["civil", "military", "prototype"];
  const decades = getUniqueValues("decade");
  const roles = getUniqueValues("role");
  const countries = getUniqueValues("country");
  const propulsions = getUniqueValues("propulsion");
  const manufacturers = getUniqueValues("manufacturer");

  {
    const correct = plane.name;
    const distractors = getSimilarAircraftNames(plane, 3);
    const { options, correctIndex } = buildChoiceSet(
      correct,
      distractors,
      state.aircraftDb.map((item) => item.name)
    );

    questions.push({
      id: `${plane.id}-image`,
      type: "image",
      tag: "Imagen",
      prompt: "¿Qué avión aparece en la imagen?",
      image: plane.image || null,
      wikiTitle: plane.wikiTitle || null,
      aircraftName: plane.name,
      options,
      correctIndex
    });
  }

  {
    const correct = plane.manufacturer;
    const distractors = manufacturers.filter((item) => item !== correct);
    const { options, correctIndex } = buildChoiceSet(correct, distractors);

    questions.push({
      id: `${plane.id}-manufacturer`,
      type: "manufacturer",
      tag: "Fabricante",
      prompt: `¿Quién fabrica el ${plane.name}?`,
      image: plane.image || null,
      wikiTitle: plane.wikiTitle || null,
      aircraftName: plane.name,
      options,
      correctIndex
    });
  }

  {
    const correct = plane.domain;
    const distractors = domains.filter((item) => item !== correct);
    const { options, correctIndex } = buildChoiceSet(correct, distractors);

    questions.push({
      id: `${plane.id}-domain`,
      type: "domain",
      tag: "Ámbito",
      prompt: `¿El ${plane.name} pertenece al ámbito civil, militar o prototipo?`,
      image: plane.image || null,
      wikiTitle: plane.wikiTitle || null,
      aircraftName: plane.name,
      options,
      correctIndex
    });
  }

  {
    const correct = plane.role;
    const distractors = roles.filter((item) => item !== correct);
    const { options, correctIndex } = buildChoiceSet(correct, distractors);

    questions.push({
      id: `${plane.id}-role`,
      type: "role",
      tag: "Rol",
      prompt: `¿Cuál es el rol principal del ${plane.name}?`,
      image: plane.image || null,
      wikiTitle: plane.wikiTitle || null,
      aircraftName: plane.name,
      options,
      correctIndex
    });
  }

  {
    const correct = plane.decade;
    const distractors = decades.filter((item) => item !== correct);
    const { options, correctIndex } = buildChoiceSet(correct, distractors);

    questions.push({
      id: `${plane.id}-decade`,
      type: "decade",
      tag: "Década",
      prompt: `¿En qué década encaja mejor el origen del ${plane.name}?`,
      image: plane.image || null,
      wikiTitle: plane.wikiTitle || null,
      aircraftName: plane.name,
      options,
      correctIndex
    });
  }

  {
    const correct = plane.country;
    const distractors = countries.filter((item) => item !== correct);
    const { options, correctIndex } = buildChoiceSet(correct, distractors);

    questions.push({
      id: `${plane.id}-country`,
      type: "country",
      tag: "Origen",
      prompt: `¿Con qué país o área se asocia el ${plane.name}?`,
      image: plane.image || null,
      wikiTitle: plane.wikiTitle || null,
      aircraftName: plane.name,
      options,
      correctIndex
    });
  }

  {
    const correct = plane.propulsion;
    const distractors = propulsions.filter((item) => item !== correct);
    const { options, correctIndex } = buildChoiceSet(correct, distractors);

    questions.push({
      id: `${plane.id}-propulsion`,
      type: "propulsion",
      tag: "Propulsión",
      prompt: `¿Qué tipo de propulsión utiliza el ${plane.name}?`,
      image: plane.image || null,
      wikiTitle: plane.wikiTitle || null,
      aircraftName: plane.name,
      options,
      correctIndex
    });
  }

  if (typeof plane.engines === "number") {
    const correct = `${plane.engines} motores`;
    const engineOptions = ["1 motores", "2 motores", "3 motores", "4 motores", "6 motores", "8 motores"];
    const distractors = engineOptions.filter((item) => item !== correct);
    const { options, correctIndex } = buildChoiceSet(correct, distractors);

    questions.push({
      id: `${plane.id}-engines`,
      type: "engines",
      tag: "Motores",
      prompt: `¿Cuántos motores tiene el ${plane.name}?`,
      image: plane.image || null,
      wikiTitle: plane.wikiTitle || null,
      aircraftName: plane.name,
      options,
      correctIndex
    });
  }

  if (typeof plane.seats === "number") {
    const correct = String(plane.seats);
    const distractors = getClosestNumbers(
      plane.seats,
      state.aircraftDb.map((item) => item.seats),
      3
    ).map(String);

    const allSeats = state.aircraftDb
      .map((item) => item.seats)
      .filter((value) => typeof value === "number")
      .sort((a, b) => a - b)
      .map(String);

    const { options, correctIndex } = buildChoiceSet(correct, distractors, allSeats);

    questions.push({
      id: `${plane.id}-seats`,
      type: "seats",
      tag: "Plazas",
      prompt: `¿Qué cifra de plazas o pasajeros se usa para el ${plane.name}?`,
      image: plane.image || null,
      wikiTitle: plane.wikiTitle || null,
      aircraftName: plane.name,
      options,
      correctIndex
    });
  }

  if (plane.cruiseLabel) {
    const correct = plane.cruiseLabel;
    const distractors = state.aircraftDb
      .map((item) => item.cruiseLabel)
      .filter((value) => value && value !== correct);

    const { options, correctIndex } = buildChoiceSet(correct, [...new Set(distractors)]);

    questions.push({
      id: `${plane.id}-speed`,
      type: "speed",
      tag: "Velocidad",
      prompt: `¿Qué velocidad de crucero se usa para el ${plane.name}?`,
      image: plane.image || null,
      wikiTitle: plane.wikiTitle || null,
      aircraftName: plane.name,
      options,
      correctIndex
    });
  }

  if (typeof plane.rangeNm === "number") {
    const correct = formatNm(plane.rangeNm);
    const distractors = getClosestNumbers(
      plane.rangeNm,
      state.aircraftDb.map((item) => item.rangeNm),
      3
    ).map(formatNm);

    const allRanges = state.aircraftDb
      .map((item) => item.rangeNm)
      .filter((value) => typeof value === "number")
      .sort((a, b) => a - b)
      .map(formatNm);

    const { options, correctIndex } = buildChoiceSet(correct, distractors, allRanges);

    questions.push({
      id: `${plane.id}-range`,
      type: "range",
      tag: "Alcance",
      prompt: `¿Qué alcance en millas náuticas se usa para el ${plane.name}?`,
      image: plane.image || null,
      wikiTitle: plane.wikiTitle || null,
      aircraftName: plane.name,
      options,
      correctIndex
    });
  }

  return questions;
}

const LIGHT_QUESTIONS = [
  {
    id: "lights-left-wing",
    type: "lights",
    tag: "Luces",
    prompt: "¿Qué color lleva la luz de posición del ala izquierda?",
    image: null,
    options: ["Roja", "Verde", "Blanca", "Ámbar"],
    correctIndex: 0
  },
  {
    id: "lights-right-wing",
    type: "lights",
    tag: "Luces",
    prompt: "¿Qué color lleva la luz de posición del ala derecha?",
    image: null,
    options: ["Verde", "Roja", "Blanca", "Azul"],
    correctIndex: 0
  },
  {
    id: "lights-tail",
    type: "lights",
    tag: "Luces",
    prompt: "¿Dónde va normalmente la luz blanca de posición?",
    image: null,
    options: ["En la cola", "En el ala izquierda", "En el morro", "En el tren principal"],
    correctIndex: 0
  },
  {
    id: "lights-anticollision",
    type: "lights",
    tag: "Luces",
    prompt: "¿Qué luces sirven principalmente para hacer más visible el avión y evitar colisiones?",
    image: null,
    options: [
      "Las luces anticolisión o estrobos",
      "Solo las luces de cabina",
      "Solo las luces de taxi",
      "Solo las luces del panel"
    ],
    correctIndex: 0
  }
];

function buildQuestionBank(mode) {
  const generated = state.aircraftDb.flatMap(buildAircraftQuestions);

  if (mode === "image") return shuffle(generated.filter((q) => q.type === "image"));
  if (mode === "manufacturer") return shuffle(generated.filter((q) => q.type === "manufacturer"));
  if (mode === "seats") return shuffle(generated.filter((q) => q.type === "seats"));
  if (mode === "speed") return shuffle(generated.filter((q) => q.type === "speed"));
  if (mode === "engines") return shuffle(generated.filter((q) => q.type === "engines"));
  if (mode === "lights") return shuffle([...LIGHT_QUESTIONS]);

  return shuffle([...generated, ...LIGHT_QUESTIONS]);
}

function startQuiz() {
  if (!state.isLoaded) return;

  clearAdvanceTimeout();
  stopTimer();

  const mode = els.mode.value;
  const bank = buildQuestionBank(mode);

  state.playerName = els.playerName.value.trim() || "Anónimo";
  state.questions = shuffle(bank);
  state.currentIndex = 0;
  state.currentQuestion = null;
  state.score = 0;
  state.answered = 0;
  state.locked = false;

  updateStats();
  startTimer();
  showScreen("quiz");
  renderQuestion();
}

async function resolveAircraftImage(question) {
  const key = question.wikiTitle || question.aircraftName || question.prompt;
  if (!key) return null;

  if (state.imageCache.has(key)) {
    return state.imageCache.get(key);
  }

  try {
    const title = encodeURIComponent(question.wikiTitle || question.aircraftName);
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}`);

    if (!res.ok) throw new Error("Wiki image lookup failed");

    const data = await res.json();
    const src = data.originalimage?.source || data.thumbnail?.source || null;

    state.imageCache.set(key, src);
    return src;
  } catch {
    state.imageCache.set(key, null);
    return null;
  }
}

async function renderImage(question) {
  const requestToken = ++state.imageRequestToken;
  let triedWikiFallback = false;

  els.planeImage.alt = question.prompt;
  els.imageWrap.classList.remove("hidden");
  els.imageFallback.classList.add("hidden");
  els.planeImage.classList.remove("hidden");

  const localSrc = question.image || null;

  async function loadWikiFallback() {
    if (triedWikiFallback) {
      els.imageWrap.classList.add("hidden");
      return;
    }

    triedWikiFallback = true;

    const wikiSrc = await resolveAircraftImage(question);

    if (requestToken !== state.imageRequestToken) return;

    if (wikiSrc) {
      els.planeImage.src = wikiSrc;
    } else {
      els.imageWrap.classList.add("hidden");
    }
  }

  els.planeImage.onload = () => {
    if (requestToken !== state.imageRequestToken) return;
    els.planeImage.classList.remove("hidden");
    els.imageFallback.classList.add("hidden");
  };

  els.planeImage.onerror = async () => {
    if (requestToken !== state.imageRequestToken) return;
    await loadWikiFallback();
  };

  if (localSrc) {
    els.planeImage.src = localSrc;
  } else {
    await loadWikiFallback();
  }
}

function renderQuestion() {
  if (!state.questions.length) return;

  if (state.currentIndex >= state.questions.length) {
    state.questions = shuffle(state.questions);
    state.currentIndex = 0;
  }

  const question = state.questions[state.currentIndex];
  state.currentQuestion = question;
  state.locked = false;

  els.questionTag.textContent = question.tag;
  els.questionText.textContent = question.prompt;
  els.answers.innerHTML = "";
  els.feedback.classList.add("hidden");
  els.feedback.innerHTML = "";
  els.nextBtn.classList.add("hidden");

  renderImage(question);

  question.options.forEach((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "answer-btn";
    button.textContent = option;
    button.addEventListener("click", () => handleAnswer(index));
    els.answers.appendChild(button);
  });
}

function handleAnswer(selectedIndex) {
  if (state.locked || !state.currentQuestion) return;

  state.locked = true;
  const question = state.currentQuestion;
  const buttons = [...els.answers.querySelectorAll(".answer-btn")];
  const isCorrect = selectedIndex === question.correctIndex;

  state.answered += 1;
  if (isCorrect) state.score += 1;
  updateStats();

  buttons.forEach((button, index) => {
    button.disabled = true;

    if (index === question.correctIndex) {
      button.classList.add("correct");
    } else if (index === selectedIndex) {
      button.classList.add("wrong");
    }
  });

  clearAdvanceTimeout();
  state.advanceTimeoutId = setTimeout(() => {
    if (state.remainingTime > 0) {
      state.currentIndex += 1;
      renderQuestion();
    }
  }, 250);
}

function showResults(timeout = false) {
  stopTimer();
  clearAdvanceTimeout();

  const totalAnswered = state.answered;
  const percentage = totalAnswered > 0 ? Math.round((state.score / totalAnswered) * 100) : 0;
  const usedTime = MAX_TIME_SECONDS - state.remainingTime;

  saveRanking({
    name: state.playerName,
    score: state.score,
    total: totalAnswered,
    usedTime,
    date: new Date().toISOString()
  });

  els.finalScore.textContent = `Has acertado ${state.score} de ${totalAnswered} en ${usedTime}s`;
  els.finalMessage.textContent = timeout
    ? `Tiempo agotado. Precisión final: ${percentage}%.`
    : `Precisión final: ${percentage}%.`;

  renderRanking();
  showScreen("result");
}

async function init() {
  showScreen("start");
  renderRanking();
  updateStats();
  updateTimer();

  if (window.location.protocol === "file:") {
    els.loadingText.innerHTML = `
      No se puede cargar la base externa desde <strong>file://</strong>.<br><br>
      Abre esta carpeta con un servidor local.<br>
      Ejemplo rápido en una terminal dentro de la carpeta del proyecto:<br>
      <code>python -m http.server 8000</code><br><br>
      Después abre:<br>
      <code>http://localhost:8000/</code>
    `;
    return;
  }

  try {
    await loadExternalDatabase();
    state.isLoaded = true;
    els.loadingText.textContent = `Base cargada: ${state.aircraftDb.length} registros desde JSON externos.`;
    els.startBtn.disabled = false;
  } catch (error) {
    console.error(error);
    els.loadingText.textContent = `Error al cargar la base externa: ${error.message}`;
  }
}

els.startBtn.addEventListener("click", startQuiz);
els.playAgainBtn.addEventListener("click", startQuiz);
els.restartBtn.addEventListener("click", startQuiz);

init();