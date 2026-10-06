# Desktop shell, cloud infrastructure, and packaging

[Back to guide index](README.md)

## Electron responsibilities

Electron hosts the notation screen and provides desktop capabilities. The main process creates the window, starts the local recognition service, manages dialogs and files, reads clipboard images, stores app settings and practice data, and performs cloud requests.

The renderer has context isolation enabled, Node integration disabled, and sandboxing enabled. The preload bridge exposes specific APIs named `omr`, `scoreFiles`, `agent`, `pages`, `practice`, and `fills`. IPC handlers check that requests came from the trusted editor frame.

The page's content security policy loads scripts locally and uses `connect-src 'none'`. Network operations belong to the main process. Navigation and new-window creation are blocked. VexFlow and styles are local assets in the current app; older descriptions of CDN styling do not describe this setup.

## Settings and environment

App settings live in `settings.json` in the app data folder, separately from score files. Cloud help starts disabled, and enabling it records the adult-confirmed choice. A missing or unreadable settings file falls back to disabled cloud help.

Development loads a git-ignored `.env` beside `main.js`; packaged builds load it from the app data folder. Real environment variables take precedence. Important configuration names are:

| Setting | Purpose |
| --- | --- |
| `OMR_PYTHON` | Python executable used for the local service. |
| `OMR_BUNDLE` | Alternate local model bundle in development. |
| `QWEN_OMR_URL` | https address of the fine-tuned Qwen recognition server. When set, bars are read there instead of by the local model, and only with cloud help on. |
| `QWEN_OMR_TOKEN` | Password for that server, sent as a bearer token. |
| `OPENAI_API_KEY` | Credential retained in the main process. |
| `OPENAI_OMR_MODEL` | Screenshot/page recognition model override. |
| `OPENAI_MODEL` | Older fallback recognition model setting. |
| `OPENAI_AGENT_MODEL` | Assistant, fill, and teacher-summary model override. |
| `DRUMHUB_MONTHLY_CLOUD_USD` | Monthly estimated cloud-spending threshold. |
| `DRUMHUB_CLOUD_REQUESTS_PER_MINUTE` | Shared cloud-request rate limit. |

The source defaults are `gpt-5.6-sol` for recognition and `gpt-5.6-luna` for agent features. These are configured values in this checkout; provider access and pricing are not verified by this documentation.

## Shared cloud transport

Every app OpenAI request uses the shared Responses API transport. It forces `store: false`, retries temporary transport/provider failures with backoff, handles timeout and refusal errors, and redacts the configured API key from error messages.

`store: false` is a request parameter, not a claim that no data leaves the computer. Screenshot recognition sends pixels; assistant calls send questions and tool-derived facts; fill generation sends settings; teacher summaries send approved progress facts.

The screenshot recognizer also logs recognition progress and raw output to the launching terminal. Transport-level logging excludes the key, image, and prompt, but the recognition wrapper's output logging can contain the transcription and model text.

## Spending and health tracking

`cloud-budget.json` stores estimated monthly spending, request and token totals, and provider success/error status. All cloud features share the same controls. The current defaults are approximately US$5 per month and 20 requests per minute.

The monthly threshold is checked before sending, while cost is recorded from usage after receiving a response. It can therefore be exceeded by a request already allowed. Estimates use prices embedded in source, with a conservative listed rate for unknown models. They are not a provider-enforced billing cap. A provider error or unreadable local record can also limit how completely spending is tracked.

Offline features remain usable after the local cloud threshold is reached. Ask DrumHub has additional question-specific limits documented in its guide.

## Starting and packaging

From the repository root, install JavaScript dependencies with `npm install`, install `backend/requirements.txt` into the chosen Python environment, and start the editor with `npm start`. Local recognition additionally needs its released model files.

`npm run dist:dir` builds an application directory, and `npm run dist` builds the configured macOS distribution. The build copies the runtime model release to `Resources/model` and unpacks backend Python code beside the Electron archive. Dataset files and training tooling are not needed for everyday editing.

Python itself is not bundled. A packaged app launched from Finder may need an absolute `OMR_PYTHON` path in its app-data `.env`. macOS signing is disabled in the current build configuration, so the existing package is an unsigned distribution rather than a completed signed installer pipeline.

## Source map

See [main.js](../../main.js), [preload.js](../../preload.js), [app-settings.cjs](../../desktop/app-settings.cjs), [openai-client.cjs](../../desktop/openai-client.cjs), [cloud-budget.cjs](../../desktop/cloud-budget.cjs), and [package.json](../../package.json).
