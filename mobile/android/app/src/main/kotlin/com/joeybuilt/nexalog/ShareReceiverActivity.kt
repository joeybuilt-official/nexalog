package com.joeybuilt.nexalog

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import com.it_nomads.fluttersecurestorage.FlutterSecureStorage
import com.it_nomads.fluttersecurestorage.FlutterSecureStorageConfig
import com.it_nomads.fluttersecurestorage.SecurePreferencesCallback
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Silent share-target. Android invokes this Activity for ACTION_SEND
 * (text/plain) — i.e., when the user picks "Nexalog" in any app's share sheet.
 *
 * Behaviour:
 *   - No visible UI. Theme is `@android:style/Theme.Translucent.NoTitleBar.Fullscreen`.
 *   - Reads the bearer token the Flutter app itself stores via flutter_secure_storage
 *     (see mobile/lib/src/core/auth/auth_store.dart, key "nexalog_bearer_token") by
 *     invoking the plugin's own Android classes directly — same process, same
 *     ciphertext, guaranteed to match what the Flutter engine reads/writes.
 *   - POSTs multipart/form-data to `https://nexalog.com/api/capture` with the
 *     fields the route actually parses (apps/web/app/api/capture/route.ts:
 *     `text` | `url` | `file*` | `source` — the URL travels as the part named
 *     `url`, `source` is pinned `pwa-share` (the provenance the PWA manifest's
 *     share_target also sends) — and `Authorization: Bearer <token>` (the app
 *     is a native bearer-auth client;
 *     there is no WebView and no session cookie to read).
 *     The endpoint does `await req.formData()` as its FIRST statement, so a
 *     JSON body throws before any field is read and the catch answers 400 —
 *     the share never lands. Multipart is the contract the Flutter client
 *     already speaks (mobile/lib/src/core/api/capture_repo.dart) and the one
 *     the PWA manifest declares.
 *   - Shows a system Toast on save success only — duplicates are silent (per
 *     operator: "system must automatically not bookmark items that already have
 *     been"). 401 surfaces a "Open Nexalog to sign in first" toast.
 *     NOTE on duplicates: the OLD code read `duplicate` out of the capture
 *     route's body — a field /api/capture never sends (it answers 201
 *     {ok:true, captureId} unconditionally; dedupe lives on /api/bookmarks,
 *     a different model). That branch was dead code and is dropped. The
 *     duplicate probe COULD have ridden GET /api/bookmarks, but that route
 *     does NOT authenticate a bearer token (its getAuthUser path resolves
 *     only through better-auth's bearer plugin, whose verification the
 *     session-cookie shim in lib/auth/server.ts deliberately does not cover),
 *     so a bearer-auth probe would 401 forever. Silent-duplicate semantics
 *     therefore degrade to the capture route's own behaviour; a re-shared
 *     link lands a second row and toasts Saved. Fixing the bearer rejection
 *     on /api/bookmarks is a separate, web-side change.
 *   - `finishAndRemoveTask()` so the user stays in the source app and our entry
 *     never appears in Recents.
 *
 * Intentionally avoids kotlinx.coroutines so we don't pull a new Gradle
 * dependency for a single background HTTP call. Plain Thread + main-thread
 * Handler is enough.
 */
class ShareReceiverActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val sharedText = extractSharedText(intent)
        val url = sharedText?.let { firstHttpUrl(it) }
        if (url == null) {
            finishAndRemoveTask()
            return
        }
        val main = Handler(Looper.getMainLooper())
        Thread {
            val result = postCapture(url)
            main.post {
                when (result) {
                    CaptureResult.Saved -> toast("Saved to Nexalog")
                    CaptureResult.Duplicate -> { /* silent — already in library */ }
                    CaptureResult.Unauthorized -> toast("Open Nexalog to sign in first")
                    CaptureResult.Error -> toast("Couldn't save — try again")
                }
                finishAndRemoveTask()
            }
        }.start()
    }

    private fun extractSharedText(intent: Intent?): String? {
        if (intent == null) return null
        if (intent.action != Intent.ACTION_SEND) return null
        if (intent.type != "text/plain") return null
        return intent.getStringExtra(Intent.EXTRA_TEXT)
    }

    // Accept text shares from any source (browser, YouTube, Twitter, etc.).
    // The share payload is sometimes the bare URL, sometimes prose with a URL
    // embedded ("Look at this https://..."). Extract the first http(s) URL.
    private fun firstHttpUrl(text: String): String? {
        val m = Regex("""https?://\S+""").find(text)
        return m?.value
    }

    private fun toast(msg: String) {
        Toast.makeText(applicationContext, msg, Toast.LENGTH_SHORT).show()
    }

    // Reuses flutter_secure_storage's own Android module (already on :app's
    // classpath — it's a registered Dart plugin, auto-linked by the Flutter
    // Gradle plugin) with default AndroidOptions so the config matches exactly
    // what AuthStore's `const FlutterSecureStorage()` used to write the token.
    // Runs synchronously; safe because this is already called off the main thread.
    private fun readBearerToken(): String? {
        val storage = FlutterSecureStorage(applicationContext)
        val latch = CountDownLatch(1)
        var initFailed = false
        storage.initialize(FlutterSecureStorageConfig(emptyMap()), object : SecurePreferencesCallback<Void?> {
            override fun onSuccess(result: Void?) {
                latch.countDown()
            }
            override fun onError(e: Exception) {
                initFailed = true
                latch.countDown()
            }
        })
        latch.await(5, TimeUnit.SECONDS)
        if (initFailed) return null
        return try {
            storage.read(storage.addPrefixToKey("nexalog_bearer_token"))
        } catch (_: Exception) {
            null
        }
    }

    private fun postCapture(url: String): CaptureResult {
        val token = readBearerToken()
        if (token.isNullOrBlank()) {
            return CaptureResult.Unauthorized
        }

        // Multipart form data — the ONLY body /api/capture can parse (the route
        // does `await req.formData()` before it reads any field, so a JSON body
        // is a guaranteed 400 that never reaches the capture logic). The two
        // fields below are exactly what the Flutter CaptureRepo sends; no file
        // parts exist for a shared link, and `source` pins provenance.
        val boundary = "nexalog-share-${System.currentTimeMillis()}"
        val lineSeparator = "\r\n"

        var conn: HttpURLConnection? = null
        try {
            conn = (URL("$NEXALOG_BASE/api/capture").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 8000
                readTimeout = 12000
                setRequestProperty(
                    "Content-Type",
                    "multipart/form-data; boundary=$boundary",
                )
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("User-Agent", "NexalogShareReceiver/1.0")
            }

            fun formField(name: String, value: String): ByteArray {
                return (
                    "--$boundary$lineSeparator" +
                        "Content-Disposition: form-data; name=\"$name\"$lineSeparator" +
                        "Content-Type: text/plain; charset=utf-8$lineSeparator" +
                        lineSeparator +
                        value +
                        lineSeparator
                    ).toByteArray(Charsets.UTF_8)
            }

            conn.outputStream.use { out ->
                // `url` carries the extracted link — the field the use case turns
                // into a `link` capture (a `text` field is DISCARDED by
                // CreateCapture the moment a url is present, so it is never
                // sent here). `source` pins provenance.
                out.write(formField("url", url))
                out.write(formField("source", CAPTURE_SOURCE))
                out.write("--$boundary--$lineSeparator".toByteArray(Charsets.UTF_8))
                out.flush()
            }
            val code = conn.responseCode
            return when {
                code == 401 || code == 403 -> CaptureResult.Unauthorized
                code in 200..299 -> CaptureResult.Saved
                else -> CaptureResult.Error
            }
        } catch (_: Throwable) {
            return CaptureResult.Error
        } finally {
            conn?.disconnect()
        }
    }

    private enum class CaptureResult { Saved, Duplicate, Unauthorized, Error }

    companion object {
        private const val NEXALOG_BASE = "https://nexalog.com"

        /**
         * The wire contract this receiver MUST satisfy (apps/web/app/api/capture/
         * route.ts). The route's first statement is `await req.formData()`, which
         * throws on any non-form body before a single field is read — so the
         * request MUST be multipart/form-data, and the URL must travel as the
         * part named `url`. `source` must be one of pwa-share | web |
         * bookmarklet | mcp (anything else defaults to `web` silently). This
         * contract is pinned from the web side by
         * apps/web/app/api/capture/__tests__/share-target-contract.test.ts,
         * which encodes both the fields and an asserted-REJECTED JSON body — the
         * exact defect that made every share a 400 ("Couldn't save") before.
         * If the route's parser ever changes, that test fails first and this
         * block is what to reconcile.
         */
        const val CAPTURE_SOURCE = "pwa-share"
    }
}
