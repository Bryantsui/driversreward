package com.driversreward.app.data.repository

import com.driversreward.app.data.api.*
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TripRepository @Inject constructor(
    private val api: RewardsApi,
    private val authRepository: AuthRepository
) {
    suspend fun submitTrips(trips: List<TripPayload>): SubmitTripsResponse? {
        val token = authRepository.getAccessToken() ?: return null

        val response = api.submitTrips(
            token = "Bearer $token",
            request = SubmitTripsRequest(trips = trips, source = "android_app")
        )

        if (response.code() == 401) {
            val newToken = authRepository.refreshToken() ?: return null
            val retryResponse = api.submitTrips(
                token = "Bearer $newToken",
                request = SubmitTripsRequest(trips = trips, source = "android_app")
            )
            return retryResponse.body()
        }

        return response.body()
    }

    suspend fun submitActivityFeed(rawJson: String): ActivityFeedResponse? {
        val token = authRepository.getAccessToken() ?: return null

        // Parse activity feed from raw JSON — simplified
        val today = java.time.LocalDate.now().toString()
        val thirtyDaysAgo = java.time.LocalDate.now().minusDays(30).toString()

        val request = SubmitActivityFeedRequest(
            startDate = thirtyDaysAgo,
            endDate = today,
            trips = emptyList(), // TODO: parse from rawJson
            source = "android_app"
        )

        val response = api.submitActivityFeed(token = "Bearer $token", request = request)
        return response.body()
    }
}
