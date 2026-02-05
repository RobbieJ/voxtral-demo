# Voxtral Mini 4B Realtime + vLLM Demo

A tiny, dependency-free web app that streams microphone audio to a vLLM Realtime API server and renders live transcription.

## 1. Start a vLLM Realtime server (DGX Spark)

The Voxtral Mini 4B Realtime model currently targets vLLM's Realtime API.

Recommended (from the model card), using a Python virtual environment with `uv pip`:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -U pip uv
uv pip install -U vllm --torch-backend=auto --extra-index-url https://wheels.vllm.ai/nightly/cu130
uv pip install soxr librosa soundfile
```

Then launch the server:

```bash
VLLM_DISABLE_COMPILE_CACHE=1 vllm serve mistralai/Voxtral-Mini-4B-Realtime-2602 \
  --compilation_config '{"cudagraph_mode": "PIECEWISE"}' \
  --gpu-memory-utilization 0.5 \
  --host 0.0.0.0 --port 8000
```

Tip: The model card recommends temperature `0.0`, using websockets for streaming, and a default transcription delay of `480ms` (tweakable via `tekken.json`).

## 2. Run the web app (macOS)

```bash
python -m http.server 5173
```

Open `http://localhost:5173` in your browser, click **Connect**, then **Start Mic**.

## 3. Notes

- The Realtime API expects 16kHz, mono, PCM16 audio sent as base64 over a WebSocket connection.
- The default WebSocket URL in the UI is `ws://dgxspark.local:8000/v1/realtime`.
- If the WebSocket opens then immediately closes, check browser DevTools for the close code, and ensure your DGX Spark port `8000` is reachable from the Mac.

## 4. License

Apache-2.0. See `LICENSE`.
