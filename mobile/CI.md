# Nexalog mobile — CI / release runbook

Thin Flutter WebView shell wrapping https://nexalog.com/app. Built + signed +
shipped to Google Play by Pushd (`/.pushd.yaml`). Android only.

## Build triggers (pushd — updated 2026-09-26)

- **Only a `v*` tag enqueues an `android-release` build.** A plain branch push no
  longer builds an APK: `.pushd.yaml`'s `android-release` entry now carries
  `on: tags: ["v*"]`, enforced by pushd's per-entry trigger filter (`triggerSkipReason`
  in `packages/build/src/domain/trigger.ts`, pushd PR #25 / `ed7435e`). Before that
  filter existed pushd enqueued this entry on *every* push webhook — measured over
  60 days, 221 branch builds / 26.7 compute-hrs against 20 tag builds / 1.4 hrs.
- **An on-demand APK needs no tag.** `POST /builds` passes `kind === undefined`,
  which bypasses `on:` by design (an explicit request is not a webhook), and the
  entry stays on `main` — so a build can be requested from any branch:

  ```bash
  curl -XPOST localhost:4100/builds \
    -d '{"projectId":"<project-id>","repoUrl":"https://github.com/joeybuilt-official/nexalog.git","branch":"main"}'
  ```

- Builds run **one at a time** (`BUILD_CONCURRENCY=1`, `docker` label). Tag-only
  triggering removed the branch-push burst that used to queue behind a running build
  (observed: 16 queued builds, ~40 min each); still cancel superseded **queued**
  builds rather than waiting them out — cancelling mid-**run** just gets overwritten
  when the worker finishes.
- What each tag does:
  - `v*` (e.g. `v1.0.1`) → **android-release**: `flutter pub get` → build signed
    APK → **emails** it to 94700316+dustin-olenslager@users.noreply.github.com. No Play publish. Use to
    hand off a test build.
- `release-v*` (e.g. `release-v1.0.1`) → **android-publish**: same build, plus
  pushes the AAB to the Play **internal** track as a draft.

```
git tag -a v1.0.1 <sha> -m "..." && git push origin v1.0.1
git tag -a release-v1.0.1 <sha> -m "..." && git push origin release-v1.0.1
```

**Version comes from `mobile/pubspec.yaml`** (`version: 1.0.N+N`) — pushd does
not override it. The build log shows `versionCode`/`versionName` matching pubspec
(e.g. `1.0.28+28` → versionCode 28 / versionName 1.0.28). Bump pubspec before
tagging when you want the APK to install as an update.

Backend/web-only changes need NO mobile build. Only tag when `mobile/` native code
changes or to hand off a test build.

## Signing (secrets group `nexalog-signing`)
Variables: `ANDROID_KEYSTORE_BASE64` (base64 of `nexalog-upload.jks`),
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. The
build decodes `ANDROID_KEYSTORE_BASE64` to `/tmp/nexalog-upload.jks` and passes
it as `ANDROID_KEYSTORE_PATH` to `flutter build apk --release`.

**Three signing guards (2026-09-25, all refuse the build):**
1. **Gradle task-graph guard** (`mobile/android/app/build.gradle`) — `assembleRelease`/
   `bundleRelease` throw if any of the four `ANDROID_*` signing vars is unset. The
   release build type now references `signingConfigs.release` unconditionally; the
   old `keystorePath ? release : debug` fallback is gone, so the debug keystore can
   no longer be reached on a release build. This is the root-level fix — it fails
   on any machine, not just Pushd.
2. **Pre-build `keytool -list`** — fails if keystore / alias / password don't
   match, before any gradle time is spent.
3. **Post-build `apksigner verify --print-certs`** — fails unless the produced
   APK's signer is the upload cert (`CN=Nexalog, O=Joeybuilt LLC`).

Secret-name history: the four secrets were renamed `CM_*` → `ANDROID_*` during
the Pushd migration. pushd's per-project store still carries both name sets;
both decrypt to the same values (AES-256-GCM, one `ENCRYPTION_KEY`).

Keystore master copy: prod-host `<the operator's keystore backup location>/`. **A lost or
rotated upload keystore = can never update the same Play app — back it up.**

Generate (one-time):
```
keytool -genkey -v -keystore nexalog-upload.jks -keyalg RSA -keysize 2048 \
  -validity 10000 -alias nexalog
base64 -w0 nexalog-upload.jks   # paste into ANDROID_KEYSTORE_BASE64
```

## Play publish (secrets group `google-play`, reused across apps)
`GCLOUD_SERVICE_ACCOUNT_CREDENTIALS` = JSON key of a GCP service account with the
Play "Release manager" role, linked under Play Console → Users & permissions.
One-time operator step: create the app listing for `com.joeybuilt.nexalog` and
upload the FIRST AAB by hand (the Play API can't create an app or opt into Play
App Signing — it only publishes to an existing app).
