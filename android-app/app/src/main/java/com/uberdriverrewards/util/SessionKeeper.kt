package com.uberdriverrewards.util

import android.content.Context
import android.webkit.CookieManager
import android.webkit.WebView
import androidx.work.*
import com.uberdriverrewards.BuildConfig
import com.uberdriverrewards.data.api.RewardsApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manages Uber driver portal session persistence.
 *
 * Strategy:
 * 1. WebView CookieManager is set to persistent mode (cookies survive app restarts)
 * 2. Periodic WorkManager job pings drivers.uber.com to refresh session cookies
 * 3. Heartbeats sent to our backend so admin can monitor session health
 * 4. Notifies if session expires (driver needs to re-login via WebView)
 */
@Singleton
class SessionKeeper @Inject constructor(
    private val context: Context
) {
    companion object {
        private const val UBER_EARNINGS_URL = "https://drivers.uber.com/earnings"
        private const val HEARTBEAT_WORK = "uber_session_heartbeat"
        private const val REFRESH_WORK = "uber_session_refresh"
    }

    fun initialize() {
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(WebView(context), true)
    }

    fun getSessionCookies(): Map<String, String> {
        val cookieManager = CookieManager.getInstance()
        val cookieString = cookieManager.getCookie("https://drivers.uber.com") ?: return emptyMap()

        return cookieString.split(";")
            .map { it.trim() }
            .filter { it.contains("=") }
            .associate {
                val parts = it.split("=", limit = 2)
                parts[0].trim() to (parts.getOrNull(1)?.trim() ?: "")
            }
    }

    fun hasActiveSession(): Boolean {
        val cookies = getSessionCookies()
        return cookies.containsKey("sid") ||
                cookies.containsKey("csid") ||
                cookies.keys.any { it.contains("session") || it.contains("auth") }
    }

    fun persistCookies() {
        CookieManager.getInstance().flush()
    }

    fun scheduleKeepAlive() {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        // Session refresh: every 30 minutes, ping Uber to keep cookies alive
        val refreshRequest = PeriodicWorkRequestBuilder<SessionRefreshWorker>(
            30, TimeUnit.MINUTES,
            5, TimeUnit.MINUTES  // flex interval
        )
            .setConstraints(constraints)
            .addTag(REFRESH_WORK)
            .build()

        // Backend heartbeat: every 10 minutes
        val heartbeatRequest = PeriodicWorkRequestBuilder<HeartbeatWorker>(
            15, TimeUnit.MINUTES,
            5, TimeUnit.MINUTES
        )
            .setConstraints(constraints)
            .addTag(HEARTBEAT_WORK)
            .build()

        WorkManager.getInstance(context).apply {
            enqueueUniquePeriodicWork(REFRESH_WORK, ExistingPeriodicWorkPolicy.KEEP, refreshRequest)
            enqueueUniquePeriodicWork(HEARTBEAT_WORK, ExistingPeriodicWorkPolicy.KEEP, heartbeatRequest)
        }
    }

    fun cancelKeepAlive() {
        WorkManager.getInstance(context).apply {
            cancelUniqueWork(REFRESH_WORK)
            cancelUniqueWork(HEARTBEAT_WORK)
        }
    }
}

/**
 * WorkManager worker that refreshes Uber session by making a lightweight HTTP request
 * with the stored cookies, triggering cookie renewal.
 */
class SessionRefreshWorker(
    context: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            val cookieManager = CookieManager.getInstance()
            val cookies = cookieManager.getCookie("https://drivers.uber.com")

            if (cookies.isNullOrBlank()) {
                return@withContext Result.success() // No session to refresh
            }

            val url = URL("https://drivers.uber.com/earnings")
            val connection = url.openConnection() as HttpURLConnection
            connection.apply {
                requestMethod = "GET"
                setRequestProperty("Cookie", cookies)
                setRequestProperty("User-Agent", "Mozilla/5.0 DriversBonus/1.0")
                connectTimeout = 15_000
                readTimeout = 15_000
                instanceFollowRedirects = true
            }

            val responseCode = connection.responseCode
            connection.disconnect()

            // Any 2xx/3xx means session is likely alive and cookies refreshed
            if (responseCode in 200..399) {
                // Flush updated cookies to disk
                cookieManager.flush()
            }

            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}

/**
 * WorkManager worker that sends session heartbeat to our backend.
 */
class HeartbeatWorker(
    context: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            val url = URL("${BuildConfig.API_BASE_URL}/api/session/heartbeat")
            val connection = url.openConnection() as HttpURLConnection

            // Read access token from DataStore would need DI here;
            // for now use SharedPreferences as a fallback
            val prefs = applicationContext.getSharedPreferences("auth", Context.MODE_PRIVATE)
            val token = prefs.getString("access_token", null)

            if (token.isNullOrBlank()) {
                return@withContext Result.success()
            }

            connection.apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Authorization", "Bearer $token")
                doOutput = true
                connectTimeout = 10_000
                readTimeout = 10_000
            }

            connection.outputStream.use { os ->
                os.write("""{"source":"android_app"}""".toByteArray())
            }

            connection.responseCode // trigger the request
            connection.disconnect()

            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}
