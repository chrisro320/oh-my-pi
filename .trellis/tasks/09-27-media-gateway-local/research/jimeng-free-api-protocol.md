# JimengVideoProtocol (scout report, 2026-09-27)

# jimeng-free-api HTTP interface (read-only findings)

## 0. Method / evidence caveat

The container bundle could not be read: `/proc/318036/root/app` is EACCES for this user and no shell/sudo tool is mounted (only read/grep/glob/find/web_search; `xd://bash` does not exist). Instead I used the upstream source clone that the image is built from — `/home/chris/jimeng-free-api/repo`, `git remote = https://github.com/zhizinan1997/jimeng-free-api-all.git`, package.json name `jimeng-free-api` v0.0.6 (image tag is `ghcr.io/zhizinan1997/jimeng-free-api-all:latest`) — plus live read-only probes. Parity evidence gathered (no generation submitted; only GETs):

| probe | result | matches repo |
|---|---|---|
| `GET /v1/models` | 10 image + 10 video models, ids/descriptions/`model_req_key`/`supported_resolutions`/`default_resolution`/`source:"static"` | byte-for-byte equal to `STATIC_IMAGE_MODELS`+`STATIC_VIDEO_MODELS` (controllers/models.ts) incl. seedance-2.5 |
| `GET /v1/videos/generations` | `{"code":-1000,"message":"[请求有误]: 正确请求为 POST -> /v1/chat/completions，当前请求为 GET -> /v1/videos/generations 请纠正","data":null}` | exact catch-all string from `src/lib/server.ts` (`attachRoutes` tail) |
| `GET /dashboard/status` | `{"setupComplete":false}` | `routes/dashboard.ts:23` |
| `GET /ping` | `pong` | `routes/ping.ts:4` |

Divergence risk to keep in mind: repo `logs*.txt` (captured from an older local build) show the image poll log at `images.ts<535-537>`, while the current clone has it at `images.ts:616` — so the deployed image is a *slightly older revision of the same repo*. Line numbers below are clone-relative; the contracts were confirmed against live behaviour where probeable.

## 1. Route table

urlPrefix is `''` (configs/dev/service.yml has no `urlPrefix`; compose only sets SERVER_HOST/SERVER_PORT/TZ) — routes are at the paths declared below.

| Method | Path | Code | Purpose |
|---|---|---|---|
| GET | `/` | routes/index.ts:17 | serves `public/index.html` (dashboard SPA) |
| GET | `/favicon.ico` | routes/index.ts:24 | 204 empty |
| POST | `/v1/images/generations` | routes/images.ts:13 | image gen (text→img and blend/img2img) |
| POST | `/v1/chat/completions` | routes/chat.ts:14 | image **or** video, chosen by model name |
| GET | `/ping` | routes/ping.ts:4 | `"pong"` |
| POST | `/token/check` | routes/token.ts:16 | `{token}` → `{live:boolean}` |
| POST | `/token/points` | routes/token.ts:25 | Bearer → `[{token,points}]` |
| GET | `/v1/models` | routes/models.ts:10 | `?refresh=true|1`, `?type=image|video`; live-scrape when Bearer present |
| POST | `/v1/videos/generations` | routes/videos.ts:26 | video gen, **synchronous** |
| GET | `/v1/account/status` | routes/account-status.ts:10 | membership + credits of resolved credential |
| GET | `/dashboard/status` | routes/dashboard.ts:23 | `{setupComplete}` (no auth) |
| GET | `/dashboard/stats,_logs,_media,_credits,_keys` | dashboard.ts:24-45 | cookie `session` required |
| POST | `/dashboard/setup,_login,_logout,_password,_keys,_keys/:id/status` | dashboard.ts:48-89 | admin UI |
| DELETE | `/dashboard/logs,keys/:id` | dashboard.ts:92-100 | admin UI |
| GET | `/account-pool/`, `/account-pool/select`, `/account-pool/:id`, `/account-pool/:id/status` | routes/account-pool.ts:10-13 | account pool (admin cookie) |
| POST | `/account-pool/`, `/account-pool/:id/refresh-status` | :16-17 | |
| PATCH | `/account-pool/:id`, `/account-pool/:id/enabled` | :20-21 | |
| DELETE | `/account-pool/:id` | :24 | |
| any | anything else | lib/server.ts catch-all | HTTP **200** `{code:-1000,message:"[请求有误]...",data:null}` |

Explicitly absent (grep for `compositions|/v1/edits|variations` over `src/` → no hits): `/v1/images/compositions`, `/v1/images/edits`, `/v1/videos/{id}`, `/v1/videos/{id}/content`, `/v1/videos` (list). Video/Image work is only the three POSTs above; all polling is internal.

## 2. Video contract (`POST /v1/videos/generations`)

### 2.1 Request
`src/api/routes/videos.ts:26-51`
```
26 '/generations': async (request: Request) => {
28   .validate('body.model', v => _.isUndefined(v) || _.isString(v))
29   .validate('body.prompt', _.isString)                       // REQUIRED
30   .validate('body.ratio', v => _.isUndefined(v) || _.isString(v))
31   .validate('body.resolution', v => _.isUndefined(v) || _.isString(v))
32   .validate('body.duration', v => _.isUndefined(v) || _.isFinite(v))
33   .validate('body.file_paths', v => _.isUndefined(v) || _.isArray(v))
34   .validate('body.response_format', v => _.isUndefined(v) || _.isString(v))
35   .validate('headers.authorization', _.isString);             // REQUIRED
47-50  model = DEFAULT_MODEL, ratio, resolution, duration = 10, file_paths = [], response_format = "url"
54     let filePaths = [...file_paths];
55-58  // multipart files are also appended into filePaths (appendUploadedPaths:10-19)
```
Defaults: `DEFAULT_MODEL = "jimeng-video-seedance-2.0-mini"` (controllers/videos.ts:7). Unknown/absent model falls back to that key via `MODEL_MAP[model] || MODEL_MAP[DEFAULT_MODEL]` (videos.ts:22).

Accepted values (controllers/videos.ts):
* `resolution`: normalised against the model's `supportedResolutions`; auto-corrected to the model default with a warning. Catalog values: `720p`, `1080p`, `4k` (lowercase k!). Only `jimeng-video-seedance-2.0-pro` supports 1080p+4k; `3.0-pro` = 1080p; `3.0-fast` = 720p|1080p; the rest 720p only.
* `ratio`: `VIDEO_ASPECT_RATIOS = ["16:9","9:16","1:1","4:3","3:4","21:9"]` (videos.ts:~163). If the value is not in the list it falls back to prompt detection (`\d+:\d+`, 横屏/竖屏/方形) and finally `16:9`.
* `duration`: only 5 or 10. `supportsLongDuration=false` models force 5; others keep the caller value unless the prompt contains `5秒|10秒` and the parameter was the default 10; final coercion `finalDuration = finalDuration > 5 ? 10 : 5`; then `durationMs = 5s|10s` (videos.ts:352).
* `file_paths` (or multipart uploads): positional — `uploadIDs[0] → first_frame_image`, `uploadIDs[1] → end_frame_image` (videos.ts:362-427); `video_mode: hasReferenceFrame ? 0 : 2` (i2v-with-frames vs t2v, videos.ts:509); items may be http(s) URL, `data:` base64, or a local path (core.uploadFile).
* `response_format`: `"url"` (default) or `"b64_json"`.
* Ignored/unsupported: `size`, `aspect_ratio`, `seed`, `generate_audio`, `frame_images`, `input_references`, `callback_url`. (`width`/`height` exist in the controller signature but are not destructured → unused.)

### 2.2 Synchronous, not a job
`routes/videos.ts:63` awaits `generateVideoWithRetry(...)`, which awaits `generateVideo(...)`, which submits and then polls upstream **inside the request**:
```
444  await request("post", "/mweb/v1/aigc_draft/generate", refreshToken, {...})
535  const maxRetries = 60; // 20 mins
537  await new Promise((resolve) => setTimeout(resolve, 5000));
541  while (VIDEO_PROCESSING_STATES.includes(status) && retryCount < maxRetries) {   // [20,42,45] = processing (videos.ts:168)
543-551  POST /mweb/v1/get_history_by_ids  (after 10 retries alternates with /mweb/v1/get_history_records)
599-602  if processing: retryCount++; sleep 2000*min(retryCount+1,5) ms
```
So the HTTP call can hang for up to ~20 minutes (5 s initial + 60 iterations with 2–30 s sleeps) before responding. Each upstream call is `axios` with `timeout: 45000` and 3 retries (controllers/core.ts, `request()`). Upstream status `30` ⇒ `APIException(EX.API_VIDEO_GENERATION_FAILED, 生成失败: failCode)`.

### 2.3 Response
`routes/videos.ts:88-105`
```json
{ "created": 1768000000, "data": [ { "url": "https://...vlabvod.../xxx.mp4", "revised_prompt": "<prompt>" } ] }
```
`response_format === "b64_json"` ⇒ `data: [{ b64_json, revised_prompt }]` (route fetches the URL and base64-encodes it, videos.ts:89-97). There is **no** `id`, `status`, `polling_url`, `unsigned_urls`, `usage`.

### 2.4 Video via chat (alternative, same sync behaviour)
`POST /v1/chat/completions` with `model` starting with `jimeng-video` (controllers/chat.ts `isVideoModel`) calls `generateVideo` directly with `resolution:"720p"`, `ratio` default `16:9`, frames = images extracted from multimodal `messages` (first image = first frame, second = last frame), and returns an OpenAI chat envelope whose `message.content` is `![](<videoUrl>)`. Images are the same file but with `ratio:1:1`, `resolution:2k`.

### 2.5 Errors
All generation errors are HTTP **200** with `FailureBody` `{code,message,data}` (FailureBody defaults `statusCode = HTTP_STATUS_CODES.OK = 200`; `http-status-codes.ts:7`). Codes: `-2000` params invalid (validation), `-2001` upstream request failed, `-2006` content filtered, `-2007` image failed, `-2008` video failed, `-2009` insufficient Jimeng credits (`api/consts/exceptions.ts`). Upstream `ret` `5000`/`1006` → `-2009` (core.ts:549-561).

## 3. Image contract (`POST /v1/images/generations`)

Body (`routes/images.ts:13-38`): `model?`, `prompt` (required), `negative_prompt?`, `ratio?`, `resolution?`, `sample_strength?` (number, default 0.5), `response_format?`, `filePath?` (string: URL / `data:` base64 / local path) or a multipart file part (`request.files`, first file wins, images.ts:40-51). `Authorization` required.

* **`n` is not supported at all** — it is never validated, read, or forwarded (grep for `body.n`/`n:` over `src/` → no hits). Count = length of the upstream `item_list`:
  `images.ts:628  return item_list.map((item) => item.image?.large_images?.[0]?.image_url ?? item?.common_attr?.cover_url ?? null)`
  and the route maps every URL: `images.ts:85  data = imageUrls.map((url) => ({ url }))`.
  Observed in the project's own logs: `images.ts<536> ⏳ [轮询] … | 结果数: 4` (logs.txt:151, logs2.txt:151/265, logs3.txt) → upstream returned 4 images for jimeng-4.x at 2k. The catalog documents this as credits-per-generation: `benefitCountByResolution: {"2k":4,"4k":1}` for 4.1–4.7 (`controllers/models.ts`), `{"2k":3,"4k":1}` for 5.0-lite, `{"2k":8}` for 5.0-pro, `{"1k":1}` for 3.x/2.0-pro. `generateCount: 1` inside `metrics_extra` (images.ts:401) is telemetry only and does not limit the result.
  ⇒ **A caller cannot ask for 1 image; it must take all returned items (4 for 4.x@2k).**
* **`size` is not supported** — dimensions are derived from `ratio` + `resolution`:
  * `RATIO_VALUES` (`images.ts:76-85`): `21:9→0, 16:9→1, 3:2→2, 4:3→3, 1:1→8, 3:4→4, 2:3→5, 9:16→6`; unknown ratio falls back to `1:1` (with prompt-based override only when ratio is unset/default).
  * Dimension tables (`images.ts:89-141`), keyed by the same ratio strings: `DIMENSIONS_1K`, `DIMENSIONS_1_5K`, `DIMENSIONS_2K`, `DIMENSIONS_4K`. Examples: 2K `1:1 = 2048×2048` (exactly the PRD's observation), 2K `16:9 = 2560×1440`; 1K `1:1 = 1328×1328`; 1.5K `1:1 = 1536×1536`; 4K `1:1 = 4096×4096`.
  * `resolution` accepted values (lowercase, per model): 5.0-pro `4k|2k|1.5k` (default 2k), 4.x `4k|2k` (default 2k), 3.x & 2.0-pro `1k`. Unsupported value → model default, then auto-downgrade on insufficient credits (`generateImagesWithRetry`).
* Image-to-image: same endpoint. `filePath`/multipart → `generate_type:"blend"`, upstream ability `byte_edit` with `image_uri_list:[uploadID]`, `strength: 0.5` (images.ts:303-350). Only **one** reference image is used (first file / `filePath`).
* Polling: 120 × 1 s max (`images.ts:496-501`), statuses `[20,42,45]` processing, `30` failed (fail_code `2038` → `-2006` content filtered), timeout → `-2007 图像生成超时` (images.ts:620-622).
* Response: `{created, data:[{url}]}` or `{created, data:[{b64_json}]}` (images.ts:79-88). No `revised_prompt`, no `usage`.

## 4. Auth mechanism

* `tokenSplit` (`controllers/core.ts:568-573`): strip a leading `Bearer ` (case-insensitive), split on `,`, trim, drop empties.
* `resolveAuthorization` (`controllers/auth.ts:19-40`):
  1. if **any** token passes `db.validateApiKey(token)` (a dashboard-created key, shape `/^jm_[A-Za-z0-9_-]{20,}$/`) → an account is picked from the pool (`accountPool.select("round_robin")`) and its **decrypted sessionId** is used upstream; the jm_ key is kept only as the stats key.
  2. else if a token merely *looks* like a managed key → throw `"API key is invalid or disabled"`.
  3. else → `_.sample(tokens)`: a random raw session token is used as-is.
* The raw token is the **upstream Jimeng sessionid, passed through**: `generateCookie(refreshToken)` builds `sessionid=<token>; sessionid_ss=<token>; sid_tt=<token>; sid_guard=<token>|…` (core.ts `generateCookie`), and every upstream call is signed with `md5('9e2c|<last7 of uri>|7|5.8.0|<deviceTime>||11ac')` (core.ts `request`).
* There is **no proxy-level API-key gate**: `configs/dev/system.yml` defines no auth, and compose only sets `SERVER_HOST=127.0.0.1`, `SERVER_PORT=5100`, `TZ`. Any non-`jm_` Bearer string is treated as a session token, forwarded, and fails at Jimeng (→ `-2009 积分不足` for ret 5000/1006, otherwise `-2001 请求失败`).
* Multi-token: comma-separated **inside one Authorization header** (`Authorization: Bearer sid1,sid2,sid3`, README), one randomly sampled per request (no stickiness for raw tokens; round-robin only for pool accounts). `POST /token/points` returns per-token credit.
* Credential file seen on the host (path only, not read/printed): `/home/chris/.config/jimeng/`, DB at `/home/chris/jimeng-free-api/data/jimeng.db`.

## 5. Diff vs omp transport (`pi-ai/src/video/openrouter-video.ts` + `types.ts`)

| Aspect | omp `openrouter-video` | jimeng proxy | adapter must translate |
|---|---|---|---|
| submit route | `POST {baseUrl}/videos` | `POST {baseUrl}/v1/videos/generations` | path rewrite |
| body | `model, prompt, duration, resolution, aspect_ratio, size, frame_images[], input_references[], generate_audio, seed, callback_url, provider, previous_job_id, session_id, trace, user, creativity, upscale_factor` | `model, prompt, ratio, resolution, duration, file_paths[], response_format` | `aspect_ratio`→`ratio`; drop `size/generate_audio/seed/callback_url/provider/*_id/trace/user/creativity/upscale_factor` |
| flow | async job → multiple round-trips | **single blocking call**, upstream polled server-side (5 s + ≤60 iterations, ~20 min budget) | treat as one long request; per-call and gateway timeouts must exceed ~20 min |
| submit response | `VideoJob {id, status, polling_url?, generation_id?, unsigned_urls?, error?, usage?{cost}}` (omptype-validated, `id` non-empty) | `{created, data:[{url|b64_json, revised_prompt}]}` — no id/status | synthesize `VideoJob{id:<synthetic>, status:"completed", contentUrls:[data[0].url]}` |
| poll | `GET /videos/{id}` → same `VideoJob` schema; status vocabulary `queued\|processing\|pending\|in_progress\|completed\|failed\|cancelled\|expired` | **no poll route exists** | implement poll as immediate terminal state, or model jimeng as its own `api` id with a synchronous transport (`pi-ai/src/video/index.ts` dispatches on `model.api === "openrouter-video"`) |
| download | `GET /videos/{id}/content`, streams body, `video/*` content-type | no content route; CDN url is directly fetchable (`vlabvod`/`vod`), or `response_format:"b64_json"` inlines it | fetch `contentUrls[0]` directly (recommended; avoid b64 for large files) |
| frame/ref images | `frame_images:[{type:"image_url", image_url:{url}, frame_type:"first_frame"|"last_frame"}]`, plus `input_references` (image/audio/video url) | `file_paths:[url|data:url|localPath]`, **positional** (0=first frame, 1=last frame); images only | order-preserving flatten to `file_paths`; audio/video refs unsupported |
| resolution enum | `"360p"…"1080p"`, `"1K"|"2K"|"4K"` (uppercase K) | video `720p|1080p|4k` (lowercase k); images `1k|1.5k|2k|4k` | case-fold K, validate against per-model `supported_resolutions` (silent auto-downgrade otherwise) |
| aspect ratios | `16:9,9:16,1:1,4:3,3:4,3:2,2:3,21:9,9:21` | video `16:9,9:16,1:1,4:3,3:4,21:9`; images `21:9,16:9,3:2,4:3,1:1,3:4,2:3,9:16` | reject/remap `3:2`,`2:3`,`9:21` for video (`9:21`→`9:16` is not equivalent) |
| duration | arbitrary seconds | `5` or `10` only (forced) | clamp/map |
| auth | `withAuth(apiKey)` → `Authorization: Bearer <key>` + retry hook | `Authorization: Bearer <jimeng sessionid[,sid2,…]>`, random sample; optional `jm_*` managed key | supply the sessionid (or list) as the key |
| errors | non-2xx → `VideoApiError` (`ProviderHttpError`), body `{error:{message,code,type}}` | **HTTP 200** always, body `{code:-200x, message, data}`; upstream insufficiency folded into `-2009`/`-2001` | map `code<0` → transport error; `-2009` → credit/quota error class |
| output | bytes via `/content` | URL (or b64 inline) | build `VideoContent` by fetching the URL, or hand the URL to callers that accept URLs |

For the image side, the same translation bites: omp `openai-images.ts:25-43` posts `{model, prompt, n: count, response_format:"b64_json", size}` to `{baseUrl}/images/generations` where `size` comes from `resolveOpenAIImageSize()` → `"1024x1024"|"1024x1536"|"1536x1024"` (images/shared.ts:179-193). The proxy ignores both `n` and `size`; to control framing/output you must send `ratio` (`"1:1"` etc.) and `resolution` (`"2k"|"4k"`), and to control count you must accept the upstream's fixed item_list (4 at 2k for 4.x; 1 for 3.x/2.0-pro/4k). b64 output is honoured (`data[].b64_json`), API error shape is `{code,message,data}` with HTTP 200.

## 6. Practical notes for the parent task

* No generation was triggered during this investigation (only GETs to `/v1/models`, `/ping`, `/dashboard/status`, and a GET that the router rejects).
* Token values were never read or printed; only file paths and mechanisms are reported.
* The proxy is synchronous and can hold a request ~20 min — a gateway in front of it (the planned local media gateway) needs matching client/server timeouts and should probably own the download step rather than streaming b64 through JSON.
* Model ids for wiring: images `jimeng-image-5.0-pro|5.0-lite|4.7|4.6|4.5|4.1|4.0|3.1|3.0|2.0-pro`; videos `jimeng-video-seedance-2.5|2.0-mini|2.0-fast|2.0-pro|1.5-pro|3.0-pro|3.0|3.0-fast|s2.0|2.0-pro` (identical to live `/v1/models`).


[You have received this identical output 3 times. Re-reading 'agent://JimengVideoProtocol/report' will not change it — use a narrower selector (path:A-B), or proceed with the edit.]
