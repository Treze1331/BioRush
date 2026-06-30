import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabase, toHttpError } from "./supabase.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

function sendData(res, data, status = 200) {
  res.status(status).json({ data });
}

function sendError(res, error, fallbackStatus = 500) {
  const httpError = toHttpError(error, fallbackStatus) || {
    status: fallbackStatus,
    message: "Erro inesperado",
    details: null
  };

  res.status(httpError.status).json({
    error: httpError.message,
    details: httpError.details
  });
}

function requireBodyFields(req, fields) {
  const missing = fields.filter((field) => req.body?.[field] === undefined || req.body?.[field] === null);

  if (missing.length) {
    const error = new Error(`Campos obrigatorios ausentes: ${missing.join(", ")}`);
    error.status = 400;
    throw error;
  }
}

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    throw error;
  }
  return data;
}

app.get("/api/health", (req, res) => {
  sendData(res, { ok: true });
});

app.get("/api/server-time", async (req, res) => {
  try {
    const data = await rpc("get_server_time", {});
    sendData(res, { server_time: typeof data === "string" ? data : data?.server_time || data });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/rooms/:roomId", async (req, res) => {
  try {
    const { data, error } = await supabase.from("rooms").select("*").eq("id", req.params.roomId).single();
    if (error) throw error;
    sendData(res, data);
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/rooms/:roomId/players", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", req.params.roomId)
      .order("score", { ascending: false });

    if (error) throw error;
    sendData(res, data || []);
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/create-room", async (req, res) => {
  try {
    requireBodyFields(req, ["clientId", "nickname"]);
    const data = await rpc("create_room", {
      p_client_id: req.body.clientId,
      p_nickname: req.body.nickname
    });
    sendData(res, data);
  } catch (error) {
    sendError(res, error, error.status || 400);
  }
});

app.post("/api/join-room", async (req, res) => {
  try {
    requireBodyFields(req, ["code", "clientId", "nickname"]);
    const data = await rpc("join_room", {
      p_code: String(req.body.code).trim().toUpperCase(),
      p_client_id: req.body.clientId,
      p_nickname: req.body.nickname
    });
    sendData(res, data);
  } catch (error) {
    sendError(res, error, error.status || 400);
  }
});

app.post("/api/update-nickname", async (req, res) => {
  try {
    requireBodyFields(req, ["playerId", "clientId", "nickname"]);
    const data = await rpc("update_nickname", {
      p_player_id: req.body.playerId,
      p_client_id: req.body.clientId,
      p_nickname: req.body.nickname
    });
    sendData(res, data);
  } catch (error) {
    sendError(res, error, error.status || 400);
  }
});

app.post("/api/leave-room", async (req, res) => {
  try {
    requireBodyFields(req, ["playerId", "clientId"]);
    const data = await rpc("leave_room", {
      p_player_id: req.body.playerId,
      p_client_id: req.body.clientId
    });
    sendData(res, data);
  } catch (error) {
    sendError(res, error, error.status || 400);
  }
});

app.post("/api/start-game", async (req, res) => {
  try {
    requireBodyFields(req, ["roomId", "clientId"]);
    const data = await rpc("start_game", {
      p_room_id: req.body.roomId,
      p_client_id: req.body.clientId
    });
    sendData(res, data);
  } catch (error) {
    sendError(res, error, error.status || 400);
  }
});

app.post("/api/ensure-question-timer", async (req, res) => {
  try {
    requireBodyFields(req, ["roomId", "clientId"]);
    const data = await rpc("ensure_question_timer", {
      p_room_id: req.body.roomId,
      p_client_id: req.body.clientId
    });
    sendData(res, data);
  } catch (error) {
    sendError(res, error, error.status || 400);
  }
});

app.post("/api/submit-answer", async (req, res) => {
  try {
    requireBodyFields(req, ["playerId", "clientId", "answer", "timeLeft", "questionIndex", "isCorrect"]);
    const data = await rpc("submit_answer", {
      p_player_id: req.body.playerId,
      p_client_id: req.body.clientId,
      p_answer: req.body.answer,
      p_time_left: req.body.timeLeft,
      p_question_index: req.body.questionIndex,
      p_is_correct: req.body.isCorrect
    });
    sendData(res, data);
  } catch (error) {
    sendError(res, error, error.status || 400);
  }
});

app.post("/api/advance-question", async (req, res) => {
  try {
    requireBodyFields(req, ["roomId", "clientId", "questionIndex"]);
    const data = await rpc("advance_question_if_ready", {
      p_room_id: req.body.roomId,
      p_client_id: req.body.clientId,
      p_question_index: req.body.questionIndex
    });
    sendData(res, data);
  } catch (error) {
    sendError(res, error, error.status || 400);
  }
});

if (process.env.VERCEL !== "1") {
  app.use(express.static(projectRoot));
  app.get("*", (req, res) => {
    res.sendFile(path.join(projectRoot, "index.html"));
  });
}

export default app;
