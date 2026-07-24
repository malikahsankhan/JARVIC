(function () {
  const statusEl = document.getElementById("status");
  const transcriptEl = document.getElementById("transcript");
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  let ws = null;
  let recognition = null;
  let reconnectTimer = null;
  let listening = false;
  let finalBuffer = "";
  let lastInterim = "";
  let silenceTimer = null;

  const SILENCE_MS = 950;
  const MIN_CONFIDENCE = 0.45;
  const MIN_WORDS = 2;
  const NOISE = new Set(["uh", "um", "hmm", "hm", "ah", "huh", "typing", "keyboard", "mouse click", "background noise", "noise", "music", "tv", "cough", "coughing", "breathing"]);

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function send(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }

  function clean(text) {
    const value = String(text || "").replace(/[\(\[\*][^\)\]\*]*[\)\]\*]/g, " ").replace(/\s+/g, " ").trim();
    const normalized = value.toLowerCase().replace(/[^\w\s]/g, "").trim();
    if (!value || NOISE.has(normalized)) return "";
    if (normalized.split(/\s+/).filter(Boolean).length < MIN_WORDS && value.length < 8) return "";
    return value;
  }

  function ensureRecognition() {
    if (recognition) return recognition;
    if (!SpeechRecognition) {
      send({ type: "error", error: "Chrome Web Speech API is not available." });
      setStatus("Web Speech API unavailable");
      return null;
    }

    recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onspeechstart = function () {
      send({ type: "speech-start" });
      resetSilenceTimer();
    };

    recognition.onsoundstart = function () {
      resetSilenceTimer();
    };

    recognition.onresult = function (event) {
      let interim = "";
      let confidence = MIN_CONFIDENCE;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const alternative = result[0];
        const text = clean(alternative.transcript);
        confidence = typeof alternative.confidence === "number" && alternative.confidence > 0 ? alternative.confidence : 0.8;
        if (!text || confidence < MIN_CONFIDENCE) continue;
        if (result.isFinal) finalBuffer = clean((finalBuffer + " " + text).trim());
        else interim = clean((interim + " " + text).trim());
      }

      const visible = clean(finalBuffer || interim);
      if (visible) {
        lastInterim = visible;
        transcriptEl.textContent = visible;
        send({ type: "partial", text: visible, confidence });
        resetSilenceTimer();
      }
    };

    recognition.onerror = function (event) {
      if (event.error !== "no-speech" && event.error !== "aborted") send({ type: "error", error: event.error || "unknown recognition error" });
      if (event.error === "not-allowed" || event.error === "service-not-allowed") listening = false;
    };

    recognition.onend = function () {
      if (listening) {
        window.setTimeout(function () {
          try {
            recognition.start();
          } catch (_) {}
        }, 120);
      } else {
        sendFinal("ended");
      }
    };

    return recognition;
  }

  function resetSilenceTimer() {
    if (!listening) return;
    if (silenceTimer) window.clearTimeout(silenceTimer);
    silenceTimer = window.setTimeout(function () {
      stopRecognition("silence");
    }, SILENCE_MS);
  }

  function startRecognition() {
    const sr = ensureRecognition();
    if (!sr) return;
    finalBuffer = "";
    lastInterim = "";
    transcriptEl.textContent = "";
    listening = true;
    setStatus("Listening");
    try {
      sr.start();
      send({ type: "ready" });
      resetSilenceTimer();
    } catch (_) {
      send({ type: "ready" });
    }
  }

  function stopRecognition(reason) {
    if (!listening) return;
    listening = false;
    if (silenceTimer) window.clearTimeout(silenceTimer);
    silenceTimer = null;
    setStatus("Idle");
    try {
      recognition && recognition.stop();
    } catch (_) {
      sendFinal(reason || "stopped");
    }
  }

  function sendFinal(reason) {
    const text = clean(finalBuffer || lastInterim);
    if (text) send({ type: "final", text, confidence: 0.8 });
    send({ type: "stopped", reason: reason || "stopped" });
    finalBuffer = "";
    lastInterim = "";
    transcriptEl.textContent = "";
  }

  function connect() {
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(protocol + "//" + location.host);

    ws.onopen = function () {
      setStatus("Connected");
      send({ type: "ready" });
    };

    ws.onmessage = function (event) {
      let command = null;
      try {
        command = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      if (command.type === "start") startRecognition();
      if (command.type === "stop") stopRecognition("manual");
      if (command.type === "ping") send({ type: "pong" });
    };

    ws.onclose = function () {
      stopRecognition("disconnect");
      setStatus("Disconnected");
      reconnectTimer = window.setTimeout(connect, 1000);
    };

    ws.onerror = function () {
      try {
        ws.close();
      } catch (_) {}
    };
  }

  connect();
})();
