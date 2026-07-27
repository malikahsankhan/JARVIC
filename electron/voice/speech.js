(function () {
  const statusEl = document.getElementById("status");
  const transcriptEl = document.getElementById("transcript");
  const startButton = document.getElementById("startButton");
  const stopButton = document.getElementById("stopButton");
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  let ws = null;
  let recognition = null;
  let reconnectTimer = null;
  let listening = false;
  let userStopped = false;
  let finalBuffer = "";
  let lastInterim = "";
  let silenceTimer = null;
  let serviceError = null;
  let listenStartedAt = 0;

  const SILENCE_MS = 3500;
  const EMPTY_LISTEN_MS = 10000;
  const NOISE = new Set(["uh", "um", "hmm", "hm", "ah", "huh", "typing", "keyboard", "mouse click", "background noise", "noise", "music", "tv", "cough", "coughing", "breathing"]);

  console.log("speech runtime", navigator.userAgent, "api:", SpeechRecognition ? "available" : "missing", "secure:", window.isSecureContext);

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
      console.log("speech started");
      send({ type: "speech-start" });
      resetSilenceTimer();
    };

    recognition.onspeechend = function () {
      console.log("speech ended");
      resetSilenceTimer();
    };

    recognition.onsoundstart = function () {
      console.log("microphone audio detected");
      resetSilenceTimer();
    };

    recognition.onaudiostart = function () {
      console.log("microphone stream started");
      resetSilenceTimer();
    };

    recognition.onaudioend = function () {
      console.log("microphone stream ended");
      resetSilenceTimer();
    };

    recognition.onresult = function (event) {
      let interim = "";
      let confidence = 0.8;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const alternative = result[0];
        console.log("recognition result", alternative.transcript, "final:", result.isFinal, "confidence:", alternative.confidence);
        const text = clean(alternative.transcript);
        confidence = typeof alternative.confidence === "number" && alternative.confidence > 0 ? alternative.confidence : 0.8;
        if (!text) continue;
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
      const error = event.error || "unknown recognition error";
      console.log("recognition error", error);
      if (error !== "no-speech" && error !== "aborted") {
        const message = error === "network"
          ? "network: Chrome Web Speech could not reach its speech service. Use Google Chrome or Microsoft Edge with internet access, or enable the local Whisper fallback assets."
          : error;
        if (serviceError !== message) send({ type: "error", error: message });
        serviceError = message;
      }
      if (error === "network" || error === "not-allowed" || error === "service-not-allowed") {
        listening = false;
        userStopped = true;
      }
    };

    recognition.onend = function () {
      listening = false;
      sendFinal("ended");
      if (!userStopped) {
        setTimeout(function () {
          if (!userStopped) startRecognition();
        }, 300);
      }
    };

    return recognition;
  }

  function resetSilenceTimer() {
    if (!listening) return;
    if (silenceTimer) window.clearTimeout(silenceTimer);
    silenceTimer = window.setTimeout(function () {
      if (!finalBuffer && !lastInterim && Date.now() - listenStartedAt < EMPTY_LISTEN_MS) {
        resetSilenceTimer();
        return;
      }
      finalizeAndRestart();
    }, SILENCE_MS);
  }

  function startRecognition() {
    if (listening) return;
    const sr = ensureRecognition();
    if (!sr) return;
    finalBuffer = "";
    lastInterim = "";
    serviceError = null;
    userStopped = false;
    listenStartedAt = Date.now();
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
    userStopped = true;
    if (silenceTimer) window.clearTimeout(silenceTimer);
    silenceTimer = null;
    setStatus("Idle");
    try {
      recognition && recognition.stop();
    } catch (_) {
      sendFinal(reason || "stopped");
    }
  }

  function finalizeAndRestart() {
    if (!listening) return;
    listening = false;
    userStopped = true;
    if (silenceTimer) window.clearTimeout(silenceTimer);
    silenceTimer = null;
    try {
      recognition && recognition.stop();
    } catch (_) {
      sendFinal("silence");
    }
    setTimeout(function () {
      startRecognition();
    }, 300);
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

  startButton && startButton.addEventListener("click", function () {
    console.log("start button clicked");
    startRecognition();
  });

  stopButton && stopButton.addEventListener("click", function () {
    console.log("stop button clicked");
    stopRecognition("manual");
  });

  connect();
})();
