# Tests

```sh
sh tests/setup.sh all        # once: Home Assistant 2026.11.1 (venv314), test and demo configs, Playwright, backend venv
sh tests/run-all.sh          # quick: static checks, wiring, sandbox engine, backend (no Home Assistant needed)
sh tests/start-ha.sh         # the throwaway test Home Assistant on :8123
sh tests/run-all.sh --e2e    # everything, with every browser suite
```

`npm test` and `npm run test:e2e` do the same. What each suite covers is listed in `CLAUDE.md` at the top of the
repository; how the browser suites work (tokens, state folder, screenshots, the demo setup) is in
`tests/e2e/README.md`.

- `tests/setup.sh demo` and `tests/start-ha.sh demo` give the demo Home Assistant (the test config plus the
  "Away mode" function in `tests/e2e/demo/`). The README's screenshots (`tests/e2e/screens.js`) and the demo video
  (`tests/e2e/demo-video.js`) are taken there.
- `FB_FRESH=1 sh tests/setup.sh` rebuilds the config folders from scratch.
- Requirements: `uv`, Node 22, and the system TurboJPEG library (`libturbojpeg`) for the demo integration.
