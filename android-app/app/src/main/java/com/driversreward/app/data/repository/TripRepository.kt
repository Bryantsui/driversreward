package com.driversreward.app.data.repository

import android.util.Log
import com.driversreward.app.data.api.*
import org.json.JSONObject
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "DriversReward"

@Singleton
class TripRepository @Inject constructor(
    private val api: RewardsApi,
    private val authRepository: AuthRepository
) {
    suspend fun submitRawTrips(rawTrips: List<RawTripItem>): SubmitRawTripsResponse? {
        val token = authRepository.getAccessToken() ?: run {
            Log.w(TAG, "submitRawTrips: no access token")
            return null
        }

        val request = SubmitRawTripsRequest(trips = rawTrips, source = "android_app")
        Log.d(TAG, "submitRawTrips: sending ${rawTrips.size} raw trips")

        val response = api.submitRawTrips(token = "Bearer $token", request = request)

        if (response.code() == 401) {
            Log.d(TAG, "submitRawTrips: 401, refreshing token...")
            val newToken = authRepository.refreshToken() ?: return null
            val retryResponse = api.submitRawTrips(
                token = "Bearer $newToken",
                request = request
            )
            Log.d(TAG, "submitRawTrips retry: code=${retryResponse.code()}")
            return retryResponse.body()
        }

        if (!response.isSuccessful) {
            Log.e(TAG, "submitRawTrips: server error ${response.code()} — ${response.errorBody()?.string()}")
            return null
        }

        val body = response.body()
        Log.d(TAG, "submitRawTrips: created=${body?.created}, dupes=${body?.duplicates}, errors=${body?.errors}, pts=${body?.totalPointsAwarded}")
        return body
    }

    suspend fun submitTrips(trips: List<TripPayload>): SubmitTripsResponse? {
        val token = authRepository.getAccessToken() ?: return null
        val response = api.submitTrips(
            token = "Bearer $token",
            request = SubmitTripsRequest(trips = trips, source = "android_app")
        )
        if (response.code() == 401) {
            val newToken = authRepository.refreshToken() ?: return null
            return api.submitTrips(
                token = "Bearer $newToken",
                request = SubmitTripsRequest(trips = trips, source = "android_app")
            ).body()
        }
        return response.body()
    }

    suspend fun submitActivityFeed(rawJson: String): ActivityFeedResponse? {
        val token = authRepository.getAccessToken() ?: return null

        try {
            val root = JSONObject(rawJson)
            if (root.optString("status") != "success") return null
            val data = root.optJSONObject("data") ?: return null

            val activities = data.optJSONArray("activities") ?: return null
            val trips = mutableListOf<ActivityItem>()

            for (i in 0 until activities.length()) {
                val a = activities.getJSONObject(i)
                val uuid = a.optString("uuid", "")
                if (uuid.isEmpty()) continue
                trips.add(
                    ActivityItem(
                        uuid = uuid,
                        activityTitle = a.optString("activityTitle", ""),
                        formattedTotal = a.optString("formattedTotal", ""),
                        type = "TRIP"
                    )
                )
            }

            val startDate = data.optString("startDateIso", java.time.LocalDate.now().minusDays(7).toString())
            val endDate = data.optString("endDateIso", java.time.LocalDate.now().toString())

            val request = SubmitActivityFeedRequest(
                startDate = startDate,
                endDate = endDate,
                trips = trips,
                source = "android_app"
            )

            val response = api.submitActivityFeed(token = "Bearer $token", request = request)
            return response.body()
        } catch (_: Exception) {
            return null
        }
    }
}
