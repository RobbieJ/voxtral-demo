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

## 3. Run vLLM via Red Hat AI Inference Server (container)

Use the Red Hat AI Inference Server vLLM container and point the web app to the
WebSocket endpoint it exposes.

```bash
# 1) Login to Red Hat registry
podman login registry.redhat.io

# 2) Pull the CUDA image
podman pull registry.redhat.io/rhaiis/vllm-cuda-rhel9:3.2.5

# 3) If SELinux is enabled
sudo setsebool -P container_use_devices 1

# 4) Create a cache dir and set permissions
mkdir -p rhaiis-cache
chmod g+rwX rhaiis-cache

# 5) Set your HF token
echo "export HF_TOKEN=<your_HF_token>" > private.env
source private.env

# 6) Run the server
podman run --rm -it \
  --device nvidia.com/gpu=all \
  --security-opt=label=disable \
  --shm-size=4g -p 8000:8000 \
  --userns=keep-id:uid=1001 \
  --env "HUGGING_FACE_HUB_TOKEN=$HF_TOKEN" \
  --env "HF_HUB_OFFLINE=0" \
  -v ./rhaiis-cache:/opt/app-root/src/.cache:Z \
  registry.redhat.io/rhaiis/vllm-cuda-rhel9:3.2.5 \
  --model mistralai/Voxtral-Mini-4B-Realtime-2602 \
  --gpu-memory-utilization 0.5 \
  --host 0.0.0.0 --port 8000
```

Then set the web app URL to:

```
ws://<rhis-host>:8000/v1/realtime
```

If model downloads fail due to permissions, ensure the cache volume mount uses
`:Z` and keep the `--userns=keep-id:uid=1001` flag.

## 4. Notes

- The Realtime API expects 16kHz, mono, PCM16 audio sent as base64 over a WebSocket connection.
- The default WebSocket URL in the UI is `ws://dgxspark.local:8000/v1/realtime`.
- If the WebSocket opens then immediately closes, check browser DevTools for the close code, and ensure your DGX Spark port `8000` is reachable from the Mac.

## 5. License

Apache-2.0. See `LICENSE`.
