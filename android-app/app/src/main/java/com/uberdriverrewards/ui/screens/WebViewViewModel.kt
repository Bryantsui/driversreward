package com.uberdriverrewards.ui.screens

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.uberdriverrewards.data.api.TripPayload
import com.uberdriverrewards.data.repository.AuthRepository
import com.uberdriverrewards.data.repository.TripRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import java.security.MessageDigest
import javax.inject.Inject

data class WebViewUiState(
    val isLoading: Boolean = false,
    val pointsEarned: Int = 0,
    val tripsProcessed: Int = 0,
    val error: String? = null
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
        val json = Json { ignoreUnknownKeys = true }
        val root = json.parseToJsonElement(rawJson).jsonObject

        val uuid = root["uuid"]?.jsonPrimitive?.contentOrNull ?: return null
        val requestedAt = root["requestedAt"]?.jsonPrimitive?.longOrNull
            ?: (System.currentTimeMillis() / 1000)

        val cards = root["cards"]?.jsonArray ?: return null

        var vehicleType: String? = null
        var durationSeconds: Int? = null
        var distanceMeters: Int? = null
        var pickupDistrict: String? = null
        var dropoffDistrict: String? = null
        var fareAmount = 0.0
        var serviceFee = 0.0
        var bookingFee = 0.0
        var netEarnings = 0.0
        var tips = 0.0
        var currency = "USD"

        for (card in cards) {
            val cardType = card.jsonObject["type"]?.jsonPrimitive?.contentOrNull
            when (cardType) {
                "TripSummaryCard" -> {
                    vehicleType = card.jsonObject["hero"]
                        ?.jsonObject?.get("subtitle")?.jsonPrimitive?.contentOrNull
                }
                "TripBreakdownCardV2", "TripBreakdownCard" -> {
                    val items = card.jsonObject["items"]?.jsonArray ?: continue
                    for (item in items) {
                        val label = item.jsonObject["label"]?.jsonPrimitive?.contentOrNull?.lowercase() ?: ""
                        val amount = item.jsonObject["amount"]?.jsonPrimitive?.contentOrNull ?: "0"
                        val parsed = amount.replace(Regex("[^0-9.-]"), "").toDoubleOrNull() ?: 0.0

                        when {
                            "your earnings" in label || "total" in label -> netEarnings = parsed
                            "fare" == label.trim() -> fareAmount = parsed
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

        val payloadHash = sha256(rawJson)

        return TripPayload(
            tripUuid = uuid,
            vehicleType = vehicleType,
            requestedAt = requestedAt,
            durationSeconds = durationSeconds,
            distanceMeters = distanceMeters,
            pickupDistrict = pickupDistrict,
            dropoffDistrict = dropoffDistrict,
            currency = currency,
            fareAmount = fareAmount,
            serviceFee = serviceFee,
            bookingFee = bookingFee,
            tips = tips,
            netEarnings = netEarnings,
            isPoolType = root["isPoolType"]?.jsonPrimitive?.booleanOrNull ?: false,
            isSurge = root["isSurge"]?.jsonPrimitive?.booleanOrNull ?: false,
            rawPayloadHash = payloadHash
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
