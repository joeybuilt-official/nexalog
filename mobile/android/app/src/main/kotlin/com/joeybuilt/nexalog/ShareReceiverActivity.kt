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
 *   - POSTs `{ kind, content, url }` to `https://nexalog.com/api/capture` with
 *     `Authorization: Bearer <token>` (the app is a native bearer-auth client;
 *     there is no WebView and no session cookie to read).
 *   - Shows a system Toast on save success only — duplicates are silent (per
 *     operator: "system must automatically not bookmark items that already have
 *     been"). 401 surfaces a "Open Nexalog to sign in first" toast.
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

        val body = JSONObject().apply {
            put("kind", "url")
            put("content", url)
            put("url", url)
        }.toString()

        var conn: HttpURLConnection? = null
        try {
            conn = (URL("$NEXALOG_BASE/api/capture").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 8000
                readTimeout = 12000
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("User-Agent", "NexalogShareReceiver/1.0")
            }
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            return when {
                code == 401 || code == 403 -> CaptureResult.Unauthorized
                code in 200..299 -> {
                    val resBody = conn.inputStream.bufferedReader().use { it.readText() }
                    val json = try { JSONObject(resBody) } catch (_: Throwable) { null }
                    if (json?.optBoolean("duplicate", false) == true) {
                        CaptureResult.Duplicate
                    } else {
                        CaptureResult.Saved
                    }
                }
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
    }
}
