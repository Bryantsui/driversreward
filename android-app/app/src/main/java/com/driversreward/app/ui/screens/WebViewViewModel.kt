package com.driversreward.app.ui.screens

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.driversreward.app.data.api.TripPayload
import com.driversreward.app.data.repository.AuthRepository
import com.driversreward.app.data.repository.TripRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.security.MessageDigest
import javax.inject.Inject

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
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(WebViewUiState())
    val uiState: StateFlow<WebViewUiState> = _uiState.asStateFlow()

    private val pendingTrips = mutableListOf<TripPayload>()
    private val processedUuids = mutableSetOf<String>()

    fun onTripCaptured(rawJson: String) {
        viewModelScope.launch {
            try {
                val trip = parseTripResponse(rawJson) ?: return@launch
                if (processedUuids.contains(trip.tripUuid)) return@launch

                processedUuids.add(trip.tripUuid)
                pendingTrips.add(trip)

                if (pendingTrips.size >= 5) {
                    flushTrips()
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = "Failed to parse trip: ${e.message}") }
            }
        }
    }

    fun onActivityFeedCaptured(rawJson: String) {
        viewModelScope.launch {
            try {
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

    fun onAutoFetchComplete() {
        viewModelScope.launch { 
            flushTrips() 
            _uiState.update { it.copy(isSyncing = false, syncMessage = "Sync complete!") }
        }
    }

    private suspend fun flushTrips() {
        if (pendingTrips.isEmpty()) return

        val batch = pendingTrips.toList()
        pendingTrips.clear()

        try {
            val result = tripRepository.submitTrips(batch)
            _uiState.update {
                it.copy(
                    pointsEarned = it.pointsEarned + (result?.totalPointsAwarded ?: 0),
                    tripsProcessed = it.tripsProcessed + (result?.newTrips ?: 0)
                )
            }
        } catch (e: Exception) {
            pendingTrips.addAll(0, batch)
            _uiState.update { it.copy(error = "Sync failed: ${e.message}") }
        }
    }

    private fun parseTripResponse(rawJson: String): TripPayload? {
        val root = JSONObject(rawJson)

        val uuid = root.optString("uuid", "") .ifEmpty { return null }
        val requestedAt = root.optLong("requestedAt", System.currentTimeMillis() / 1000)

        val cards = root.optJSONArray("cards") ?: return null

        var vehicleType: String? = null
        var fareAmount = 0.0
        var serviceFee = 0.0
        var bookingFee = 0.0
        var netEarnings = 0.0
        var tips = 0.0
        var currency = "USD"

        for (i in 0 until cards.length()) {
            val card = cards.getJSONObject(i)
            when (card.optString("type")) {
                "TripSummaryCard" -> {
                    val hero = card.optJSONObject("hero")
                    vehicleType = hero?.optString("subtitle")
                }
                "TripBreakdownCardV2", "TripBreakdownCard" -> {
                    val items = card.optJSONArray("items") ?: continue
                    for (j in 0 until items.length()) {
                        val item = items.getJSONObject(j)
                        val label = item.optString("label", "").lowercase()
                        val amount = item.optString("amount", "0")
                        val parsed = amount.replace(Regex("[^0-9.-]"), "")
                            .toDoubleOrNull() ?: 0.0

                        when {
                            "your earnings" in label || "total" in label -> netEarnings = parsed
                            label.trim() == "fare" -> fareAmount = parsed
                            "service fee" in label -> serviceFee = kotlin.math.abs(parsed)
                            "booking fee" in label -> bookingFee = kotlin.math.abs(parsed)
                            "tip" in label -> tips = parsed
                        }

                        if ("HK$" in amount || "HKD" in amount) currency = "HKD"
                        else if ("R$" in amount || "BRL" in amount) currency = "BRL"
                    }
                }
            }
        }

        return TripPayload(
            tripUuid = uuid,
            vehicleType = vehicleType,
            requestedAt = requestedAt,
            durationSeconds = null,
            distanceMeters = null,
            pickupDistrict = null,
            dropoffDistrict = null,
            currency = currency,
            fareAmount = fareAmount,
            serviceFee = serviceFee,
            bookingFee = bookingFee,
            tips = tips,
            netEarnings = netEarnings,
            isPoolType = root.optBoolean("isPoolType", false),
            isSurge = root.optBoolean("isSurge", false),
            rawPayloadHash = sha256(rawJson)
        )
    }

    private fun sha256(input: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(input.toByteArray(Charsets.UTF_8))
        return hash.joinToString("") { "%02x".format(it) }
    }

    override fun onCleared() {
        super.onCleared()
        viewModelScope.launch { flushTrips() }
    }
}
