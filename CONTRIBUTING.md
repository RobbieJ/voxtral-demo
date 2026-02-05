# Contributing

Thanks for your interest in improving this demo!

## Quick start

1. Fork the repo and create a branch.
2. Make your changes.
3. Test locally by running the static server:

```bash
python -m http.server 5173
```

4. Open a pull request with a short description and screenshots if you changed the UI.

## Guidelines

- Keep the app dependency-free (static HTML/CSS/JS).
- Prefer clear, small changes over large refactors.
- For UI changes, ensure it still works on mobile and desktop.

## Audio + Realtime API

- Audio is streamed as 16kHz, mono, PCM16, base64.
- The Realtime WebSocket endpoint is `/v1/realtime`.

## License

By contributing, you agree that your contributions will be licensed under Apache-2.0.
