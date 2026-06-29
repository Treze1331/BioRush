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
const SERVER_CLOCK_RESYNC_INTERVAL = 15000;

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
let serverClockOffset = 0;
let serverClockSyncedAt = 0;
let hostAnsweredPlayers = new Set();
let hostAdvancePending = false;

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

function getSyncedNow() {
  return Date.now() + serverClockOffset;
}

function getTimerNow() {
  return gameMode === "multi" ? getSyncedNow() : Date.now();
}

async function syncServerClock(force = false) {
  const localNow = Date.now();
  if (!force && localNow - serverClockSyncedAt < SERVER_CLOCK_RESYNC_INTERVAL) {
    return;
  }

  const requestStartedAt = Date.now();

  try {
    const { data, error } = await supabase.rpc("get_server_time");
    if (error) throw error;

    const serverTimeValue = typeof data === "string" ? data : data?.server_time;
    const serverTime = new Date(serverTimeValue).getTime();
    if (!Number.isNaN(serverTime)) {
      const requestEndedAt = Date.now();
      const latency = requestEndedAt - requestStartedAt;
      serverClockOffset = serverTime + latency / 2 - requestEndedAt;
      serverClockSyncedAt = requestEndedAt;
      return;
    }
  } catch (error) {
    console.warn("NÃ£o foi possÃ­vel sincronizar o relÃ³gio por RPC:", error);
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      method: "HEAD",
      headers: { apikey: SUPABASE_ANON_KEY },
      cache: "no-store"
    });
    const dateHeader = response.headers.get("date");
    const serverTime = dateHeader ? new Date(dateHeader).getTime() : Number.NaN;
    if (!Number.isNaN(serverTime)) {
      const requestEndedAt = Date.now();
      const latency = requestEndedAt - requestStartedAt;
      serverClockOffset = serverTime + latency / 2 - requestEndedAt;
      serverClockSyncedAt = requestEndedAt;
    }
  } catch (error) {
    console.warn("NÃ£o foi possÃ­vel sincronizar o relÃ³gio por HTTP:", error);
  }
}

async function submitMultiplayerAnswer(answer, answerTimeLeft) {
  const payload = {
    p_player_id: session.playerId,
    p_client_id: clientId,
    p_answer: answer,
    p_time_left: answerTimeLeft,
    p_question_index: currentIndex
  };

  const response = await supabase.rpc("submit_answer", payload);
  if (!response.error) {
    return response;
  }

  const message = response.error.message || "";
  const isOldFunctionSignature =
    message.includes("p_question_index") ||
    message.includes("schema cache") ||
    message.includes("Could not find the function");

  if (!isOldFunctionSignature) {
    return response;
  }

  const { p_question_index, ...legacyPayload } = payload;
  return supabase.rpc("submit_answer", legacyPayload);
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
  .channel(`room:${roomId}`, { config: { broadcast: { self: true } } })
  .on(
    "postgres_changes",
    { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
    async (payload) => {
      currentRoom = payload.new;
      if (!currentRoom) return;

      const roomHasFinished = isRoomFinished(currentRoom);

      // Se o Host iniciou o jogo enquanto estávamos no Lobby
      if (currentRoom.status === "playing" && screens.lobby.classList.contains("screen-active") && gameMode !== "multi") {
        await beginMultiplayerGame();
      }

      // Se estamos jogando e o banco atualizou a pergunta
      if (currentRoom.status === "playing" && screens.game.classList.contains("screen-active")) {
        await handleRoomQuestionChange(currentRoom);

        // Verifica se a pergunta avançou

      }

      // Se o jogo acabou
      if (roomHasFinished && screens.game.classList.contains("screen-active") && !hasShownMultiplayerResults) {
        await showMultiplayerResults();
      }
    }
  )
  .on("broadcast", { event: "player_answer" }, ({ payload }) => {
    void handleMultiplayerAnswerBroadcast(payload);
  })
  .on("broadcast", { event: "game_state" }, ({ payload }) => {
    void handleMultiplayerStateBroadcast(payload);
  })
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

  try {
    await supabase.from("players").update({ has_answered_current_question: false }).eq("room_id", session.roomId);
  } catch (error) {
    console.warn("NÃ£o foi possÃ­vel limpar respostas antes de iniciar:", error);
  }

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
  hostAnsweredPlayers = new Set();
  hostAdvancePending = false;
  initAudio();
  startMusic();
  playStartSound();
  stopTimer();
  await syncServerClock(true);
  currentRoom = await fetchRoom(session.roomId);
  currentPlayers = await fetchPlayers(session.roomId);

  if (!currentRoom?.question_started_at && session.isHost) {
    await supabase
      .from("rooms")
      .update({
        question_started_at: new Date().toISOString(),
        question_time: Number(currentRoom?.question_time ?? QUESTION_TIME)
      })
      .eq("id", session.roomId);
    currentRoom = await fetchRoom(session.roomId);
  }

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

  if (session.isHost) {
    await broadcastMultiplayerState("playing");
  }
}

function getSyncedTimeLeft(room) {
  if (!room?.question_started_at || room?.question_time == null) {
    return QUESTION_TIME;
  }

  const startedAt = new Date(room.question_started_at).getTime();
  if (Number.isNaN(startedAt)) {
    return QUESTION_TIME;
  }

  const elapsed = Math.floor((getSyncedNow() - startedAt) / 1000);
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

function countReadyPlayers(players = currentPlayers) {
  if (!Array.isArray(players)) {
    return 0;
  }

  return players.filter((player) => Boolean(player?.has_answered_current_question)).length;
}

async function resetMultiplayerReadiness() {
  if (!session?.roomId) {
    return;
  }

  try {
    await supabase.from("players").update({ has_answered_current_question: false }).eq("room_id", session.roomId);
  } catch (error) {
    console.warn("Não foi possível limpar o estado de resposta da sala:", error);
  }
}

async function syncMultiplayerRoomState() {
  if (!session?.roomId) {
    return null;
  }

  currentRoom = await fetchRoom(session.roomId);
  return currentRoom;
}

function getQuestionStartedAtIso() {
  return new Date(getSyncedNow()).toISOString();
}

function getMultiplayerStatePayload(status = currentRoom?.status || "playing") {
  return {
    status,
    questionIndex: currentIndex,
    questionStartedAt: currentRoom?.question_started_at || getQuestionStartedAtIso(),
    questionTime: getCurrentQuestionTimeLimit(),
    players: currentPlayers.map((player) => ({ ...player })),
    answeredPlayerIds: [...hostAnsweredPlayers]
  };
}

async function broadcastMultiplayerState(status = currentRoom?.status || "playing") {
  if (!roomChannel || !session?.isHost) {
    return;
  }

  await roomChannel.send({
    type: "broadcast",
    event: "game_state",
    payload: getMultiplayerStatePayload(status)
  });
}

async function handleMultiplayerStateBroadcast(payload) {
  if (!payload || gameMode !== "multi") {
    return;
  }

  if (Array.isArray(payload.players)) {
    currentPlayers = payload.players;
    renderLeaderboard(currentPlayers);
  }

  currentRoom = {
    ...(currentRoom || {}),
    status: payload.status || "playing",
    current_question_index: Number(payload.questionIndex ?? currentIndex),
    question_started_at: payload.questionStartedAt || currentRoom?.question_started_at,
    question_time: Number(payload.questionTime || currentRoom?.question_time || QUESTION_TIME),
    total_questions: TOTAL_QUESTIONS
  };

  if (payload.status === "finished") {
    await showMultiplayerResults();
    return;
  }

  await handleRoomQuestionChange(currentRoom);
}

function updateHostPlayerScore(answerPayload) {
  const playerIndex = currentPlayers.findIndex((player) => player.id === answerPayload.playerId);
  if (playerIndex < 0) {
    return;
  }

  const player = { ...currentPlayers[playerIndex] };
  const question = currentQuestions[answerPayload.questionIndex];
  const isCorrect = Boolean(question && answerPayload.answer === question.answer);
  const timeBonus = Math.max(0, Number(answerPayload.timeLeft || 0));
  const earnedPoints = isCorrect ? 100 + timeBonus * 5 : 0;

  player.has_answered_current_question = true;
  player.last_points = earnedPoints;
  player.score = Number(player.score || 0) + earnedPoints;
  player.correct_count = Number(player.correct_count || 0) + (isCorrect ? 1 : 0);
  player.streak = isCorrect ? Number(player.streak || 0) + 1 : 0;

  currentPlayers.splice(playerIndex, 1, player);
}

async function handleMultiplayerAnswerBroadcast(payload) {
  if (!payload || gameMode !== "multi" || !session?.isHost || hostAdvancePending) {
    return;
  }

  if (Number(payload.questionIndex) !== currentIndex || hostAnsweredPlayers.has(payload.playerId)) {
    return;
  }

  hostAnsweredPlayers.add(payload.playerId);
  updateHostPlayerScore(payload);
  renderLeaderboard(currentPlayers);
  await broadcastMultiplayerState("playing");

  if (hostAnsweredPlayers.size >= currentPlayers.length) {
    scheduleHostQuestionAdvance();
  }
}

function markMissingPlayersAsTimedOut() {
  if (!session?.isHost || hostAdvancePending || gameMode !== "multi") {
    return;
  }

  currentPlayers.forEach((player) => {
    if (hostAnsweredPlayers.has(player.id)) {
      return;
    }

    hostAnsweredPlayers.add(player.id);
    updateHostPlayerScore({
      playerId: player.id,
      questionIndex: currentIndex,
      answer: "",
      timeLeft: 0
    });
  });

  void broadcastMultiplayerState("playing");
  scheduleHostQuestionAdvance();
}

function scheduleHostQuestionAdvance() {
  if (!session?.isHost || hostAdvancePending) {
    return;
  }

  hostAdvancePending = true;
  window.setTimeout(() => {
    void advanceHostQuestion();
  }, FEEDBACK_DELAY);
}

async function advanceHostQuestion() {
  if (!session?.isHost || gameMode !== "multi") {
    return;
  }

  hostAdvancePending = false;
  hostAnsweredPlayers = new Set();
  currentPlayers = currentPlayers.map((player) => ({
    ...player,
    has_answered_current_question: false
  }));

  const nextIndex = currentIndex + 1;
  if (nextIndex >= TOTAL_QUESTIONS) {
    currentIndex = TOTAL_QUESTIONS;
    currentRoom = {
      ...(currentRoom || {}),
      status: "finished",
      current_question_index: TOTAL_QUESTIONS
    };
    await broadcastMultiplayerState("finished");
    await showMultiplayerResults();
    return;
  }

  currentIndex = nextIndex;
  currentRoom = {
    ...(currentRoom || {}),
    status: "playing",
    current_question_index: currentIndex,
    question_started_at: getQuestionStartedAtIso(),
    question_time: getCurrentQuestionTimeLimit(),
    total_questions: TOTAL_QUESTIONS
  };

  try {
    await supabase
      .from("rooms")
      .update({
        current_question_index: currentIndex,
        question_started_at: currentRoom.question_started_at,
        question_time: currentRoom.question_time,
        status: "playing"
      })
      .eq("id", session.roomId);
  } catch (error) {
    console.warn("NÃ£o foi possÃ­vel persistir o avanÃ§o da pergunta:", error);
  }

  await broadcastMultiplayerState("playing");
  renderQuestion();
}

async function finishMultiplayerIfNeeded(room = null) {
  if (!session || gameMode !== "multi" || hasShownMultiplayerResults) {
    return false;
  }

  const resolvedRoom = room || (await syncMultiplayerRoomState());
  const remoteFinished = Boolean(resolvedRoom && isRoomFinished(resolvedRoom));

  if (remoteFinished) {
    hasShownMultiplayerResults = true;
    await showMultiplayerResults();
    return true;
  }

  return false;
}

async function handleRoomQuestionChange(room) {
  if (!room || gameMode !== "multi") {
    return;
  }

  await syncServerClock();

  if (await finishMultiplayerIfNeeded(room)) {
    return;
  }

  const remoteIndex = Number(room.current_question_index ?? currentIndex);
  if (!Number.isFinite(remoteIndex)) {
    return;
  }

  if (remoteIndex < currentIndex) {
    return;
  }

  if (remoteIndex !== currentIndex) {
    currentIndex = remoteIndex;
    pendingQuestionIndex = null;
    isLocked = false;
    renderQuestion();
    return;
  }

  syncTimerFromRoom(room);
}

function syncTimerFromRoom(room) {
  if (!room?.question_started_at || gameMode !== "multi") {
    return;
  }

  const startedAt = new Date(room.question_started_at).getTime();
  if (Number.isNaN(startedAt)) {
    return;
  }

  questionStartedAt = startedAt;
  timeLeft = getSyncedTimeLeft(room);
  updateTimer();
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
  questionStartedAt = useRoomTime ? new Date(currentRoom.question_started_at).getTime() : getTimerNow();
  lastTickSecond = null;
  timeLeft = useRoomTime ? getSyncedTimeLeft(currentRoom) : questionTimeLimit;

  if (timeLeft <= 0 && gameMode !== "multi") {
    timeLeft = questionTimeLimit;
    questionStartedAt = getTimerNow();
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

async function handleAnswer(selectedButton, correctAnswer) {
  if (isLocked) {
    return;
  }

  isLocked = true;
  const selectedAnswer = selectedButton.dataset.answer;
  const isCorrect = selectedAnswer === correctAnswer;
  feedbackUntil = Date.now() + FEEDBACK_DELAY;

  if (gameMode === "multi" && session) {
    waitingForMultiplayerAdvance = true;

    try {
      // Envia a resposta para o Supabase
      const { data, error } = await submitMultiplayerAnswer(selectedAnswer, timeLeft);

      if (error) throw error;

      if (data?.stale_answer) {
        const roomState = await syncMultiplayerRoomState();
        if (roomState) {
          await handleRoomQuestionChange(roomState);
        }
        return;
      }

      // Pinta a tela com a resposta correta imediatamente para dar feedback ao jogador atual
      if (data?.is_correct ?? isCorrect) {
        selectedButton.classList.add("correct");
        playCorrectSound();
      } else {
        selectedButton.classList.add("wrong");
        playWrongSound();
      }

      revealAnswer(data?.correct_answer || correctAnswer, selectedButton);

      // Atualiza o Placar localmente (o subscribePlayers já fará isso também)
      currentPlayers = await fetchPlayers(session.roomId);
      const self = currentPlayers.find((player) => player.id === session.playerId);
      score = self?.score || score;
      correctCount = self?.correct_count || correctCount;
      renderLeaderboard(currentPlayers);

      const roomState = await syncMultiplayerRoomState();
      if (roomState) {
        await handleRoomQuestionChange(roomState);
      }

    } catch (error) {
      console.error("Falha ao enviar resposta no multiplayer:", error);
    }
    return;
  }

  stopTimer();

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
      await submitMultiplayerAnswer("", 0);
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

    try {
      currentPlayers = await fetchPlayers(session.roomId);
      renderLeaderboard(currentPlayers);
      const roomState = await syncMultiplayerRoomState();
      if (roomState) {
        currentRoom = roomState;
        await handleRoomQuestionChange(roomState);
      }
    } catch (error) {
      console.warn("Não foi possível sincronizar a sala após o timeout:", error);
    }

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
    const elapsed = Math.floor((getTimerNow() - questionStartedAt) / 1000);
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
