import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  TOTAL_QUESTIONS,
  FEEDBACK_DELAY,
  QUESTION_TIME,
  MAX_PLAYERS
} from "./config.js";
import { questionPool } from "./questions.js";
import {
  initAudio,
  playStartSound,
  playCorrectSound,
  playWrongSound,
  playTimeoutSound,
  playTickSound,
  playFinishSound,
  startMusic,
  stopMusic
} from "./audio.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const screens = {
  menu: document.querySelector("#menu-screen"),
  lobby: document.querySelector("#lobby-screen"),
  game: document.querySelector("#game-screen"),
  result: document.querySelector("#result-screen")
};

const nicknameInput = document.querySelector("#nickname-input");
const roomCodeInput = document.querySelector("#room-code-input");
const menuError = document.querySelector("#menu-error");
const soloButton = document.querySelector("#solo-button");
const createRoomButton = document.querySelector("#create-room-button");
const joinRoomButton = document.querySelector("#join-room-button");
const lobbyCodeText = document.querySelector("#lobby-code-text");
const lobbyPlayersList = document.querySelector("#lobby-players-list");
const lobbyStatusText = document.querySelector("#lobby-status-text");
const lobbyError = document.querySelector("#lobby-error");
const startGameButton = document.querySelector("#start-game-button");
const leaveLobbyButton = document.querySelector("#leave-lobby-button");
const editNicknameButton = document.querySelector("#edit-nickname-button");
const progressFill = document.querySelector("#progress-fill");
const questionCounter = document.querySelector("#question-counter");
const timerText = document.querySelector("#timer-text");
const questionText = document.querySelector("#question-text");
const answersGrid = document.querySelector("#answers-grid");
const leaderboardBar = document.querySelector("#leaderboard-bar");
const scoreText = document.querySelector("#score-text");
const percentageText = document.querySelector("#percentage-text");
const percentageRing = document.querySelector(".percentage-ring");
const feedbackText = document.querySelector("#feedback-text");
const successImage = document.querySelector("#success-image");
const resultTitle = document.querySelector("#result-title");
const resultPodium = document.querySelector("#result-podium");
const restartButton = document.querySelector("#restart-button");
const backToMenuButton = document.querySelector("#back-to-menu-button");

const CLIENT_ID_KEY = "quiz-client-id";
const NICKNAME_KEY = "quiz-nickname";

let clientId = getOrCreateClientId();
let session = null;
let roomChannel = null;
let playersChannel = null;
let advanceIntervalId = null;

let currentQuestions = [];
let currentIndex = 0;
let score = 0;
let correctCount = 0;
let isLocked = false;
let timeLeft = QUESTION_TIME;
let questionStartedAt = 0;
let lastTickSecond = null;
let timerId = null;
let feedbackUntil = 0;
let pendingQuestionIndex = null;
let currentRoom = null;
let currentPlayers = [];
let gameMode = "solo";
let hasShownMultiplayerResults = false;
let feedbackTimeoutId = null;
let waitingForMultiplayerAdvance = false;
let multiplayerAdvancePending = false;

function getOrCreateClientId() {
  let stored = localStorage.getItem(CLIENT_ID_KEY);
  if (!stored) {
    stored = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, stored);
  }
  return stored;
}

function getStoredNickname() {
  return localStorage.getItem(NICKNAME_KEY) || "";
}

function saveNickname(value) {
  localStorage.setItem(NICKNAME_KEY, value.trim());
}

function getNickname() {
  return nicknameInput.value.trim();
}

function validateNickname(nickname) {
  if (nickname.length < 2 || nickname.length > 20) {
    return "Apelido deve ter entre 2 e 20 caracteres.";
  }
  return "";
}

function showError(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

function showScreen(screenName) {
  Object.values(screens).forEach((screen) => screen.classList.remove("screen-active"));
  screens[screenName].classList.add("screen-active");
}

function shuffleArray(array) {
  const copy = [...array];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }
  return copy;
}

function clearMultiplayerAdvanceTimer() {
  if (feedbackTimeoutId !== null) {
    window.clearTimeout(feedbackTimeoutId);
    feedbackTimeoutId = null;
  }
  multiplayerAdvancePending = false;
}

function cleanupSubscriptions() {
  clearMultiplayerAdvanceTimer();

  if (roomChannel) {
    supabase.removeChannel(roomChannel);
    roomChannel = null;
  }
  if (playersChannel) {
    supabase.removeChannel(playersChannel);
    playersChannel = null;
  }
  if (advanceIntervalId !== null) {
    window.clearInterval(advanceIntervalId);
    advanceIntervalId = null;
  }
}

async function fetchPlayers(roomId) {
  const { data, error } = await supabase
    .from("players")
    .select("*")
    .eq("room_id", roomId)
    .order("score", { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
}

async function fetchRoom(roomId) {
  const { data, error } = await supabase.from("rooms").select("*").eq("id", roomId).single();
  if (error) {
    throw error;
  }
  return data;
}

function renderLeaderboard(players) {
  if (!leaderboardBar) {
    return;
  }

  if (gameMode === "solo" || !players.length) {
    leaderboardBar.hidden = true;
    leaderboardBar.innerHTML = "";
    return;
  }

  leaderboardBar.hidden = false;
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const leader = sorted[0];

  leaderboardBar.innerHTML = `
    <div class="leaderboard-inner">
      <p class="leaderboard-title">Ranking da partida</p>
      <div class="leaderboard-list">
        ${sorted
          .map((player, index) => {
            const isSelf = session && player.id === session.playerId;
            const isLeader = player.id === leader.id;
            const streakLabel = player.streak > 1 ? `<span class="streak-badge">🔥×${player.streak}</span>` : "";
            const pointsDelta =
              player.last_points > 0 ? `<span class="points-delta">+${player.last_points}</span>` : "";

            return `
              <div class="leaderboard-item ${isLeader ? "is-leader" : ""} ${isSelf ? "is-self" : ""}">
                <span class="leaderboard-rank">${index + 1}º</span>
                <span class="leaderboard-name">${escapeHtml(player.nickname)}${isSelf ? " (você)" : ""}</span>
                ${streakLabel}
                ${pointsDelta}
                <span class="leaderboard-score">${player.score} pts</span>
              </div>
            `;
          })
          .join("")}
      </div>
      <p class="leaderboard-leader">Líder: <strong>${escapeHtml(leader.nickname)}</strong> com ${leader.score} pts</p>
    </div>
  `;
}

function escapeHtml(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderLobby() {
  if (!session) {
    return;
  }

  lobbyCodeText.textContent = session.code;
  startGameButton.hidden = !session.isHost;
  lobbyStatusText.textContent =
    currentRoom?.status === "waiting"
      ? `Aguardando jogadores (${currentPlayers.length}/${MAX_PLAYERS})`
      : "Partida em andamento...";

  lobbyPlayersList.innerHTML = currentPlayers
    .map((player) => {
      const badges = [];
      if (player.is_host) {
        badges.push("Host");
      }
      if (player.id === session.playerId) {
        badges.push("Você");
      }
      return `<li>${escapeHtml(player.nickname)}${badges.length ? ` <span>(${badges.join(" · ")})</span>` : ""}</li>`;
    })
    .join("");
}

function subscribeToRoom(roomId) {
  cleanupSubscriptions();

  roomChannel = supabase
    .channel(`room:${roomId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
      async (payload) => {
        currentRoom = payload.new;
        if (!currentRoom) {
          return;
        }

        const isRoomFinished = currentRoom.status === "finished" || currentRoom.current_question_index >= currentRoom.total_questions;

        if (
          currentRoom.status === "playing" &&
          screens.lobby.classList.contains("screen-active") &&
          gameMode !== "multi"
        ) {
          await beginMultiplayerGame();
        }

        if (currentRoom.status === "playing" && screens.game.classList.contains("screen-active")) {
          await handleRoomQuestionChange(currentRoom);
        }

        if (isRoomFinished && screens.game.classList.contains("screen-active")) {
          await showMultiplayerResults();
        }
      }
    )
    .subscribe();

  playersChannel = supabase
    .channel(`players:${roomId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` },
      async () => {
        currentPlayers = await fetchPlayers(roomId);
        const self = currentPlayers.find((player) => player.id === session.playerId);
        if (self) {
          session.isHost = self.is_host;
        }
        renderLobby();
        renderLeaderboard(currentPlayers);
      }
    )
    .subscribe();
}

async function createRoom() {
  const nickname = getNickname();
  const nicknameError = validateNickname(nickname);
  if (nicknameError) {
    showError(menuError, nicknameError);
    return;
  }

  saveNickname(nickname);
  showError(menuError, "");

  const { data, error } = await supabase.rpc("create_room", {
    p_client_id: clientId,
    p_nickname: nickname
  });

  if (error) {
    showError(menuError, error.message);
    return;
  }

  session = {
    roomId: data.room_id,
    playerId: data.player_id,
    code: data.code,
    isHost: true
  };

  currentRoom = await fetchRoom(session.roomId);
  currentPlayers = await fetchPlayers(session.roomId);
  subscribeToRoom(session.roomId);
  showError(lobbyError, "");
  showScreen("lobby");
  renderLobby();
}

async function joinRoom() {
  const nickname = getNickname();
  const code = roomCodeInput.value.trim().toUpperCase();
  const nicknameError = validateNickname(nickname);

  if (nicknameError) {
    showError(menuError, nicknameError);
    return;
  }

  if (code.length !== 6) {
    showError(menuError, "Informe o código da sala com 6 caracteres.");
    return;
  }

  saveNickname(nickname);
  showError(menuError, "");

  const { data, error } = await supabase.rpc("join_room", {
    p_code: code,
    p_client_id: clientId,
    p_nickname: nickname
  });

  if (error) {
    showError(menuError, error.message);
    return;
  }

  session = {
    roomId: data.room_id,
    playerId: data.player_id,
    code: data.code,
    isHost: false
  };

  currentRoom = await fetchRoom(session.roomId);
  currentPlayers = await fetchPlayers(session.roomId);
  const self = currentPlayers.find((player) => player.id === session.playerId);
  session.isHost = Boolean(self?.is_host);
  subscribeToRoom(session.roomId);
  showError(lobbyError, "");
  showScreen("lobby");
  renderLobby();
}

async function updateNicknameInRoom() {
  if (!session) {
    return;
  }

  const nickname = window.prompt("Novo apelido:", getNickname());
  if (!nickname) {
    return;
  }

  const nicknameError = validateNickname(nickname.trim());
  if (nicknameError) {
    showError(lobbyError, nicknameError);
    return;
  }

  const { error } = await supabase.rpc("update_nickname", {
    p_player_id: session.playerId,
    p_client_id: clientId,
    p_nickname: nickname.trim()
  });

  if (error) {
    showError(lobbyError, error.message);
    return;
  }

  saveNickname(nickname.trim());
  nicknameInput.value = nickname.trim();
  showError(lobbyError, "");
  currentPlayers = await fetchPlayers(session.roomId);
  renderLobby();
}

async function leaveLobby() {
  if (session) {
    await supabase.rpc("leave_room", {
      p_player_id: session.playerId,
      p_client_id: clientId
    });
  }

  cleanupSubscriptions();
  session = null;
  currentRoom = null;
  currentPlayers = [];
  showError(lobbyError, "");
  showScreen("menu");
}

async function startMultiplayerFromLobby() {
  if (!session?.isHost) {
    return;
  }

  showError(lobbyError, "");

  const { error } = await supabase.rpc("start_game", {
    p_room_id: session.roomId,
    p_client_id: clientId
  });

  if (error) {
    showError(lobbyError, error.message);
  }
}

async function beginMultiplayerGame() {
  gameMode = "multi";
  hasShownMultiplayerResults = false;
  waitingForMultiplayerAdvance = false;
  multiplayerAdvancePending = false;
  initAudio();
  startMusic();
  playStartSound();
  stopTimer();
  currentRoom = await fetchRoom(session.roomId);
  currentPlayers = await fetchPlayers(session.roomId);

  const questionIndices = Array.isArray(currentRoom?.question_indices) && currentRoom.question_indices.length
    ? currentRoom.question_indices
    : Array.from({ length: TOTAL_QUESTIONS }, (_, index) => index);

  currentQuestions = questionIndices.map((index) => ({
    ...questionPool[index],
    options: [...questionPool[index].options]
  }));

  currentIndex = Number.isInteger(Number(currentRoom?.current_question_index))
    ? Number(currentRoom.current_question_index)
    : 0;
  currentIndex = Math.min(Math.max(0, currentIndex), TOTAL_QUESTIONS - 1);

  score = 0;
  correctCount = 0;
  isLocked = false;
  pendingQuestionIndex = null;
  feedbackUntil = 0;
  resultPodium.hidden = true;
  percentageRing.parentElement.hidden = false;
  showScreen("game");
  renderLeaderboard(currentPlayers);
  renderQuestion();
  startAdvancePolling();
}

function startAdvancePolling() {
  if (advanceIntervalId !== null) {
    window.clearInterval(advanceIntervalId);
  }

  advanceIntervalId = window.setInterval(async () => {
    if (!session || gameMode !== "multi" || !screens.game.classList.contains("screen-active") || hasShownMultiplayerResults) {
      return;
    }

    try {
      const syncedRoom = await syncMultiplayerRoomState();
      if (syncedRoom) {
        await finishMultiplayerIfNeeded(syncedRoom);
        if (!hasShownMultiplayerResults) {
          await handleRoomQuestionChange(syncedRoom);
        }
      }
    } catch (error) {
      console.error("Erro ao verificar o estado da sala multiplayer:", error);
    }
  }, 700);
}

function getSyncedTimeLeft(room) {
  if (!room?.question_started_at || room?.question_time == null) {
    return QUESTION_TIME;
  }

  const startedAt = new Date(room.question_started_at).getTime();
  if (Number.isNaN(startedAt)) {
    return QUESTION_TIME;
  }

  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  const questionTime = Number(room.question_time) || QUESTION_TIME;
  return Math.max(0, questionTime - elapsed);
}

function isRoomFinished(room) {
  if (!room) {
    return false;
  }

  const currentQuestionIndex = Number(room.current_question_index ?? 0);
  const totalQuestions = Number(room.total_questions ?? TOTAL_QUESTIONS ?? 0);
  return Boolean(room.status === "finished" || currentQuestionIndex >= totalQuestions);
}

async function finishMultiplayerIfNeeded(room = null) {
  if (!session || gameMode !== "multi" || hasShownMultiplayerResults) {
    return false;
  }

  const resolvedRoom = room || (await syncMultiplayerRoomState());
  const localProgressComplete = currentIndex >= TOTAL_QUESTIONS;
  const remoteFinished = Boolean(resolvedRoom && isRoomFinished(resolvedRoom));
  const shouldFinish = Boolean(remoteFinished || localProgressComplete);

  if (shouldFinish) {
    hasShownMultiplayerResults = true;
    await showMultiplayerResults();
    return true;
  }

  return false;
}

async function syncMultiplayerRoomState() {
  if (!session?.roomId || gameMode !== "multi") {
    return null;
  }

  try {
    currentRoom = await fetchRoom(session.roomId);
    return currentRoom;
  } catch (error) {
    console.error("Erro ao sincronizar sala multiplayer:", error);
    return null;
  }
}

async function handleRoomQuestionChange(room) {
  if (!room) {
    return;
  }

  const remoteIndex = Number(room.current_question_index ?? currentIndex);
  if (!isRoomFinished(room) && Number.isFinite(remoteIndex) && remoteIndex <= currentIndex) {
    return;
  }

  if (await finishMultiplayerIfNeeded(room)) {
    return;
  }

  if (Number.isFinite(remoteIndex)) {
    pendingQuestionIndex = remoteIndex;
    tryRenderPendingQuestion();
  }
}

function tryRenderPendingQuestion() {
  if (pendingQuestionIndex === null || Date.now() < feedbackUntil) {
    return;
  }

  if (pendingQuestionIndex <= currentIndex && !isRoomFinished(currentRoom)) {
    pendingQuestionIndex = null;
    return;
  }

  currentIndex = pendingQuestionIndex;
  pendingQuestionIndex = null;
  isLocked = false;
  renderQuestion();
}

function startSoloGame() {
  gameMode = "solo";
  hasShownMultiplayerResults = false;
  waitingForMultiplayerAdvance = false;
  multiplayerAdvancePending = false;
  cleanupSubscriptions();
  session = null;
  initAudio();
  startMusic();
  playStartSound();
  stopTimer();
  currentQuestions = shuffleArray(questionPool)
    .slice(0, TOTAL_QUESTIONS)
    .map((item) => ({
      ...item,
      options: [...item.options]
    }));
  currentIndex = 0;
  score = 0;
  correctCount = 0;
  isLocked = false;
  pendingQuestionIndex = null;
  feedbackUntil = 0;
  resultPodium.hidden = true;
  percentageRing.parentElement.hidden = false;
  renderLeaderboard([]);
  showScreen("game");
  renderQuestion();
}

function getCurrentQuestionTimeLimit() {
  if (gameMode === "multi" && currentRoom?.question_time != null) {
    const roomTime = Number(currentRoom.question_time);
    if (Number.isFinite(roomTime) && roomTime > 0) {
      return roomTime;
    }
  }

  return QUESTION_TIME;
}

function renderQuestion() {
  if (!currentQuestions.length || currentIndex >= currentQuestions.length) {
    if (gameMode === "multi") {
      void showMultiplayerResults();
    } else {
      showSoloResults();
    }
    return;
  }

  clearMultiplayerAdvanceTimer();

  const currentQuestion = currentQuestions[currentIndex];
  const progressPercentage = (currentIndex / TOTAL_QUESTIONS) * 100;

  stopTimer();
  progressFill.style.width = `${progressPercentage}%`;
  questionCounter.textContent = `Questão ${currentIndex + 1} de ${TOTAL_QUESTIONS}`;
  questionText.textContent = currentQuestion.question;
  answersGrid.innerHTML = "";
  isLocked = false;
  waitingForMultiplayerAdvance = false;

  const useRoomTime = gameMode === "multi" && currentRoom?.question_started_at && currentRoom?.question_time != null;
  const questionTimeLimit = getCurrentQuestionTimeLimit();
  questionStartedAt = useRoomTime ? new Date(currentRoom.question_started_at).getTime() : Date.now();
  lastTickSecond = null;
  timeLeft = useRoomTime ? getSyncedTimeLeft(currentRoom) : questionTimeLimit;

  if (timeLeft <= 0) {
    timeLeft = questionTimeLimit;
    questionStartedAt = Date.now();
  }

  startTimer(questionTimeLimit);

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

async function advanceMultiplayerAfterFeedback() {
  if (!session || gameMode !== "multi" || hasShownMultiplayerResults) {
    return;
  }

  const syncedRoom = await syncMultiplayerRoomState();
  if (await finishMultiplayerIfNeeded(syncedRoom)) {
    return;
  }

  if (syncedRoom && Number(syncedRoom.current_question_index ?? currentIndex) !== currentIndex) {
    pendingQuestionIndex = Number(syncedRoom.current_question_index ?? currentIndex);
    tryRenderPendingQuestion();
    return;
  }

  if (waitingForMultiplayerAdvance) {
    feedbackTimeoutId = window.setTimeout(() => {
      advanceToNextQuestionInMultiplayer();
    }, 1000);
  }
}

async function handleAnswer(selectedButton, correctAnswer) {
  if (isLocked) {
    return;
  }

  isLocked = true;
  stopTimer();
  const selectedAnswer = selectedButton.dataset.answer;
  const isCorrect = selectedAnswer === correctAnswer;
  feedbackUntil = Date.now() + FEEDBACK_DELAY;

  if (gameMode === "multi" && session) {
    let submissionData = null;
    waitingForMultiplayerAdvance = true;

    try {
      const { data, error } = await supabase.rpc("submit_answer", {
        p_player_id: session.playerId,
        p_client_id: clientId,
        p_answer: selectedAnswer,
        p_time_left: timeLeft
      });

      if (error) {
        throw error;
      }

      submissionData = data;
    } catch (error) {
      console.warn("Falha ao enviar resposta no multiplayer, usando avanço local:", error);
    }

    if (submissionData?.is_correct) {
      selectedButton.classList.add("correct");
      playCorrectSound();
    } else {
      selectedButton.classList.add("wrong");
      playWrongSound();
    }

    revealAnswer(submissionData?.correct_answer || correctAnswer, selectedButton);

    try {
      currentPlayers = await fetchPlayers(session.roomId);
      const self = currentPlayers.find((player) => player.id === session.playerId);
      score = self?.score || 0;
      correctCount = self?.correct_count || 0;
      renderLeaderboard(currentPlayers);
    } catch (error) {
      console.warn("Não foi possível atualizar o ranking após a resposta:", error);
    }

    scheduleMultiplayerAdvance();
    return;
  }

  if (isCorrect) {
    score += 1;
    correctCount += 1;
    selectedButton.classList.add("correct");
    playCorrectSound();
  } else {
    selectedButton.classList.add("wrong");
    playWrongSound();
  }

  revealAnswer(correctAnswer, selectedButton);
  scheduleNextQuestion();
}

async function handleTimeout() {
  if (isLocked) {
    return;
  }

  isLocked = true;
  stopTimer();
  playTimeoutSound();
  feedbackUntil = Date.now() + FEEDBACK_DELAY;
  const correctAnswer = currentQuestions[currentIndex].answer;

  if (gameMode === "multi" && session) {
    waitingForMultiplayerAdvance = true;

    try {
      await supabase.rpc("submit_answer", {
        p_player_id: session.playerId,
        p_client_id: clientId,
        p_answer: "",
        p_time_left: 0
      });
    } catch (error) {
      console.warn("Falha ao registrar timeout no multiplayer, usando fallback local:", error);
    }

    revealAnswer(correctAnswer);

    try {
      currentPlayers = await fetchPlayers(session.roomId);
      renderLeaderboard(currentPlayers);
    } catch (error) {
      console.warn("Não foi possível atualizar o ranking após o timeout:", error);
    }

    scheduleMultiplayerAdvance();
    return;
  }

  revealAnswer(correctAnswer);
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
      showSoloResults();
    }
  }, FEEDBACK_DELAY);
}

function scheduleMultiplayerAdvance() {
  if (!session || gameMode !== "multi" || hasShownMultiplayerResults) {
    return;
  }

  clearMultiplayerAdvanceTimer();
  multiplayerAdvancePending = true;
  feedbackTimeoutId = window.setTimeout(() => {
    feedbackTimeoutId = null;
    multiplayerAdvancePending = false;
    advanceToNextQuestionInMultiplayer();
  }, FEEDBACK_DELAY);
}

function advanceToNextQuestionInMultiplayer() {
  if (!session || gameMode !== "multi" || hasShownMultiplayerResults) {
    return;
  }

  if (waitingForMultiplayerAdvance && Date.now() < feedbackUntil) {
    return;
  }

  const remoteIndex = Number(currentRoom?.current_question_index ?? currentIndex);
  if (Number.isFinite(remoteIndex) && remoteIndex > currentIndex) {
    pendingQuestionIndex = remoteIndex;
    tryRenderPendingQuestion();
    return;
  }

  currentIndex += 1;
  if (currentIndex < TOTAL_QUESTIONS) {
    renderQuestion();
  } else {
    void showMultiplayerResults();
  }
}

function showSoloResults() {
  stopTimer();
  stopMusic();
  playFinishSound();
  const percentage = Math.round((correctCount / TOTAL_QUESTIONS) * 100);

  progressFill.style.width = "100%";
  resultTitle.textContent = "Rodada concluída";
  scoreText.textContent = `Você acertou ${correctCount} de ${TOTAL_QUESTIONS}!`;
  percentageText.textContent = `${percentage}%`;
  percentageRing.style.setProperty("--score-angle", `${percentage * 3.6}deg`);
  feedbackText.textContent = getFeedbackMessage(percentage);
  successImage.hidden = correctCount <= 7;
  resultPodium.hidden = true;
  percentageRing.parentElement.hidden = false;
  restartButton.textContent = "Jogar Novamente";
  showScreen("result");
}

async function showMultiplayerResults() {
  if (hasShownMultiplayerResults && screens.result.classList.contains("screen-active")) {
    return;
  }

  hasShownMultiplayerResults = true;
  stopTimer();
  stopMusic();
  playFinishSound();
  cleanupSubscriptions();

  let sorted = [];

  try {
    if (session?.roomId) {
      currentPlayers = await fetchPlayers(session.roomId);
    } else {
      currentPlayers = [];
    }
  } catch (error) {
    console.error("Erro ao carregar resultados do multiplayer:", error);
    currentPlayers = [];
  }

  try {
    sorted = [...currentPlayers].sort((a, b) => (b.score || 0) - (a.score || 0));
    const self = sorted.find((player) => player.id === session?.playerId);
    const selfRank = sorted.findIndex((player) => player.id === session?.playerId) + 1;

    progressFill.style.width = "100%";
    resultTitle.textContent = "Partida encerrada";
    scoreText.textContent = `Você ficou em ${selfRank > 0 ? `${selfRank}º` : "na classificação"} com ${self?.score || 0} pts`;
    feedbackText.textContent = `Você acertou ${self?.correct_count || 0} de ${TOTAL_QUESTIONS} questões nesta partida.`;
    successImage.hidden = true;
    percentageRing.parentElement.hidden = true;

    resultPodium.hidden = false;
    resultPodium.innerHTML = sorted.length
      ? sorted
          .slice(0, 3)
          .map((player, index) => {
            const medal = ["🥇", "🥈", "🥉"][index];
            const nickname = escapeHtml(player.nickname || player?.nickname || "Jogador");
            return `
              <div class="podium-item">
                <span class="podium-medal">${medal}</span>
                <strong>${nickname}</strong>
                <span>${player.score || 0} pts</span>
              </div>
            `;
          })
          .join("")
      : `<div class="podium-item"><strong>Não foi possível carregar o ranking.</strong></div>`;
  } catch (error) {
    console.error("Erro ao renderizar resultados do multiplayer:", error);
    resultPodium.innerHTML = `<div class="podium-item"><strong>Não foi possível carregar o ranking.</strong></div>`;
    scoreText.textContent = "A partida terminou, mas não foi possível carregar o ranking completo.";
    feedbackText.textContent = "Você pode voltar ao menu e tentar novamente.";
  } finally {
    restartButton.textContent = "Voltar ao menu";
    showScreen("result");
  }
}

function startTimer(timeLimit = getCurrentQuestionTimeLimit()) {
  updateTimer();

  timerId = window.setInterval(() => {
    const elapsed = Math.floor((Date.now() - questionStartedAt) / 1000);
    timeLeft = Math.max(0, timeLimit - elapsed);

    updateTimer();

    if (timeLeft <= 3 && timeLeft > 0 && timeLeft !== lastTickSecond) {
      lastTickSecond = timeLeft;
      playTickSound();
    }

    if (timeLeft <= 0) {
      handleTimeout();
    }
  }, 200);
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

function restartFromResults() {
  if (gameMode === "solo") {
    startSoloGame();
    return;
  }

  hasShownMultiplayerResults = false;
  cleanupSubscriptions();
  session = null;
  currentRoom = null;
  currentPlayers = [];
  showScreen("menu");
}

nicknameInput.value = getStoredNickname();
soloButton.addEventListener("click", startSoloGame);
createRoomButton.addEventListener("click", createRoom);
joinRoomButton.addEventListener("click", joinRoom);
startGameButton.addEventListener("click", startMultiplayerFromLobby);
leaveLobbyButton.addEventListener("click", leaveLobby);
editNicknameButton.addEventListener("click", updateNicknameInRoom);
restartButton.addEventListener("click", restartFromResults);
backToMenuButton.addEventListener("click", () => {
  cleanupSubscriptions();
  session = null;
  showScreen("menu");
});
