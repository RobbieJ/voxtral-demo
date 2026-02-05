const wsUrlInput = document.querySelector("#wsUrl");
const modelInput = document.querySelector("#model");
const chunkMsInput = document.querySelector("#chunkMs");

const connectBtn = document.querySelector("#connectBtn");
const disconnectBtn = document.querySelector("#disconnectBtn");
const startBtn = document.querySelector("#startBtn");
const stopBtn = document.querySelector("#stopBtn");
const commitBtn = document.querySelector("#commitBtn");
const clearBtn = document.querySelector("#clearBtn");
const autoReconnectInput = document.querySelector("#autoReconnect");

const connectionStatus = document.querySelector("#connectionStatus");
const micStatus = document.querySelector("#micStatus");
const rateStatus = document.querySelector("#rateStatus");
const closeStatus = document.querySelector("#closeStatus");
const transcript = document.querySelector("#transcript");
const partialText = document.querySelector("#partialText");
const meter = document.querySelector("#level");

let ws = null;
let audioContext = null;
let processor = null;
let input = null;
let stream = null;
let streaming = false;
let pendingText = "";
let meterLevel = 0;
let meterAnimation = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let intentionalClose = false;
let keepAliveTimer = null;
let generationInProgress = false;
let bytesBuffered = 0;
let commitTimer = null;

const targetSampleRate = 16000;
const maxReconnectDelayMs = 10000;
const keepAliveIntervalMs = 20000;
const minBufferedBytes = targetSampleRate * 2 * 0.08; // 80ms of 16kHz PCM16
const commitIntervalMs = 300;

const updateStatus = (el, text, tone = "") => {
  el.textContent = text;
  if (tone === "ok") {
    el.style.background = "#d8f3dc";
  } else if (tone === "warn") {
    el.style.background = "#ffe5d9";
  } else {
    el.style.background = "#efe6da";
  }
};

const addTranscriptLine = (text) => {
  if (!text.trim()) {
    return;
  }

  const line = document.createElement("p");
  line.textContent = text.trim();
  transcript.appendChild(line);
  transcript.querySelector(".placeholder")?.remove();
  transcript.scrollTop = transcript.scrollHeight;
};

const resetPartial = () => {
  pendingText = "";
  partialText.textContent = "—";
};

const setButtons = (connected) => {
  connectBtn.disabled = connected;
  disconnectBtn.disabled = !connected;
  startBtn.disabled = !connected;
  stopBtn.disabled = !connected || !streaming;
  commitBtn.disabled = !connected || !streaming;
};

const connect = () => {
  if (ws) {
    ws.close();
  }

  const url = wsUrlInput.value.trim();
  if (!url) {
    alert("Enter a vLLM Realtime URL first.");
    return;
  }

  intentionalClose = false;
  ws = new WebSocket(url);
  updateStatus(connectionStatus, "Connecting…", "warn");

  ws.addEventListener("open", () => {
    updateStatus(connectionStatus, "Connected", "ok");
    setButtons(true);
    reconnectAttempts = 0;
    clearReconnectTimer();
    sendSessionUpdate();
    startKeepAlive();
  });

  ws.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    handleServerMessage(payload);
  });

  ws.addEventListener("close", (event) => {
    updateStatus(connectionStatus, "Disconnected");
    setButtons(false);
    stopMic();
    stopKeepAlive();
    stopCommitLoop();
    closeStatus.textContent = `Code ${event.code || 0}${event.reason ? `: ${event.reason}` : ""}`;
    if (!intentionalClose) {
      scheduleReconnect();
    }
  });

  ws.addEventListener("error", () => {
    updateStatus(connectionStatus, "Error", "warn");
  });
};

const disconnect = () => {
  if (ws) {
    intentionalClose = true;
    ws.close();
  }
};

const sendSessionUpdate = () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  ws.send(
    JSON.stringify({
      type: "session.update",
      model: modelInput.value.trim(),
      session: {
        model: modelInput.value.trim(),
      },
    })
  );
};

const handleServerMessage = (payload) => {
  if (!payload || !payload.type) {
    return;
  }

  if (payload.type === "transcription.delta") {
    generationInProgress = true;
    pendingText += payload.delta || "";
    partialText.textContent = pendingText || "—";
  }

  if (payload.type === "transcription.done") {
    const finalText = payload.text || payload.transcript || pendingText;
    addTranscriptLine(finalText);
    resetPartial();
    generationInProgress = false;
    bytesBuffered = 0;
    if (streaming) {
      sendCommit();
    }
  }

  if (payload.type === "error") {
    const message = payload.message || payload.error || "Unknown error";
    updateStatus(connectionStatus, "Server error", "warn");
    console.error("Realtime error:", payload);
    partialText.textContent = `Error: ${message}`;
    generationInProgress = false;
    bytesBuffered = 0;
  }
};

const startMic = async () => {
  if (streaming) {
    return;
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    alert("Connect to vLLM first.");
    return;
  }

  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioContext = new AudioContext();
  const chunkMs = Math.max(40, Number(chunkMsInput.value) || 160);
  const bufferSize = pickBufferSize(audioContext.sampleRate, chunkMs);
  input = audioContext.createMediaStreamSource(stream);
  processor = audioContext.createScriptProcessor(bufferSize, 1, 1);

  input.connect(processor);
  processor.connect(audioContext.destination);

  rateStatus.textContent = `${audioContext.sampleRate} Hz`;
  updateStatus(micStatus, "Streaming", "ok");

  streaming = true;
  setButtons(true);
  resetPartial();
  startCommitLoop();

  processor.onaudioprocess = (event) => {
    const raw = event.inputBuffer.getChannelData(0);
    updateMeter(raw);
    const downsampled = downsampleBuffer(raw, audioContext.sampleRate, targetSampleRate);
    if (!downsampled.length) {
      return;
    }

    const pcm = floatTo16BitPCM(downsampled);
    const base64 = arrayBufferToBase64(pcm.buffer);
    bytesBuffered += pcm.byteLength;

    ws.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio: base64,
      })
    );
  };

  beginMeterAnimation();
};

const stopMic = () => {
  if (!streaming) {
    return;
  }

  streaming = false;
  if (processor) {
    processor.disconnect();
  }
  if (input) {
    input.disconnect();
  }
  if (audioContext) {
    audioContext.close();
  }
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }

  stopCommitLoop();
  bytesBuffered = minBufferedBytes;
  sendCommit(true);
  updateStatus(micStatus, "Idle");
  setButtons(true);
  endMeterAnimation();
  meter.style.width = "0%";
};

const sendCommit = (final = false) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  if (generationInProgress && !final) {
    return;
  }

  if (!final && bytesBuffered < minBufferedBytes) {
    return;
  }

  ws.send(
    JSON.stringify({
      type: "input_audio_buffer.commit",
      final,
    })
  );
  generationInProgress = true;
  bytesBuffered = 0;
};

const downsampleBuffer = (buffer, sampleRate, targetRate) => {
  if (targetRate === sampleRate) {
    return buffer;
  }

  if (targetRate > sampleRate) {
    return buffer;
  }

  const ratio = sampleRate / targetRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  let offset = 0;

  for (let i = 0; i < newLength; i++) {
    const nextOffset = Math.round((i + 1) * ratio);
    let sum = 0;
    let count = 0;

    for (let j = offset; j < nextOffset && j < buffer.length; j++) {
      sum += buffer[j];
      count += 1;
    }

    result[i] = sum / count;
    offset = nextOffset;
  }

  return result;
};

const pickBufferSize = (sampleRate, chunkMs) => {
  const ideal = Math.round((sampleRate * chunkMs) / 1000);
  const sizes = [256, 512, 1024, 2048, 4096, 8192, 16384];
  return sizes.reduce((closest, size) => {
    return Math.abs(size - ideal) < Math.abs(closest - ideal) ? size : closest;
  }, sizes[0]);
};

const floatTo16BitPCM = (float32) => {
  const output = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
};

const arrayBufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const updateMeter = (buffer) => {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }
  const rms = Math.sqrt(sum / buffer.length);
  meterLevel = Math.min(1, rms * 3);
};

const beginMeterAnimation = () => {
  if (meterAnimation) {
    cancelAnimationFrame(meterAnimation);
  }

  const tick = () => {
    meter.style.width = `${Math.round(meterLevel * 100)}%`;
    meterAnimation = requestAnimationFrame(tick);
  };

  tick();
};

const endMeterAnimation = () => {
  if (meterAnimation) {
    cancelAnimationFrame(meterAnimation);
  }
  meterAnimation = null;
};

const scheduleReconnect = () => {
  if (!autoReconnectInput.checked) {
    return;
  }
  clearReconnectTimer();
  reconnectAttempts += 1;
  const delay = Math.min(maxReconnectDelayMs, 1000 * Math.pow(2, reconnectAttempts - 1));
  updateStatus(connectionStatus, `Reconnecting in ${Math.ceil(delay / 1000)}s`, "warn");
  reconnectTimer = setTimeout(() => {
    connect();
  }, delay);
};

const clearReconnectTimer = () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }
  reconnectTimer = null;
};

const startKeepAlive = () => {
  stopKeepAlive();
  keepAliveTimer = setInterval(() => {
    sendSessionUpdate();
  }, keepAliveIntervalMs);
};

const stopKeepAlive = () => {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
  }
  keepAliveTimer = null;
};

const startCommitLoop = () => {
  stopCommitLoop();
  commitTimer = setInterval(() => {
    sendCommit(false);
  }, commitIntervalMs);
};

const stopCommitLoop = () => {
  if (commitTimer) {
    clearInterval(commitTimer);
  }
  commitTimer = null;
};

connectBtn.addEventListener("click", connect);
disconnectBtn.addEventListener("click", disconnect);
startBtn.addEventListener("click", startMic);
stopBtn.addEventListener("click", stopMic);
commitBtn.addEventListener("click", () => sendCommit(true));
clearBtn.addEventListener("click", () => {
  transcript.innerHTML = "<p class=\"placeholder\">Waiting for audio…</p>";
  resetPartial();
});

setButtons(false);
resetPartial();
