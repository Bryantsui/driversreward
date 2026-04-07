package com.uberdriverrewards.data.api

import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.*

interface RewardsApi {

    @POST("api/auth/login")
    suspend fun login(@Body request: LoginRequest): Response<AuthResponse>

    @POST("api/auth/register")
    suspend fun register(@Body request: RegisterRequest): Response<AuthResponse>

    @POST("api/auth/refresh")
    suspend fun refreshToken(@Body request: RefreshRequest): Response<TokenResponse>

    @POST("api/ingest/trips")
    suspend fun submitTrips(
        @Header("Authorization") token: String,
        @Body request: SubmitTripsRequest
    ): Response<SubmitTripsResponse>

    @POST("api/ingest/activity-feed")
    suspend fun submitActivityFeed(
        @Header("Authorization") token: String,
        @Body request: SubmitActivityFeedRequest
    ): Response<ActivityFeedResponse>

    @GET("api/rewards/balance")
    suspend fun getBalance(@Header("Authorization") token: String): Response<BalanceResponse>

    @GET("api/rewards/gift-cards")
    suspend fun getGiftCards(@Header("Authorization") token: String): Response<GiftCardsResponse>

    @POST("api/rewards/redeem")
    suspend fun redeemGiftCard(
        @Header("Authorization") token: String,
        @Body request: RedeemRequest
    ): Response<RedeemResponse>
}

@Serializable
data class LoginRequest(val email: String, val password: String)

@Serializable
data class RegisterRequest(
    val email: String,
    val password: String,
    val name: String,
    val phone: String? = null,
    val region: String,
    val referralCode: String? = null,
    val consentDataCollection: Boolean = true
)

@Serializable
data class RefreshRequest(val refreshToken: String)

@Serializable
data class AuthResponse(
    val driver: DriverInfo,
    val accessToken: String,
    val refreshToken: String
)

@Serializable
data class TokenResponse(val accessToken: String, val refreshToken: String)

@Serializable
data class DriverInfo(
    val id: String,
    val email: String,
    val region: String,
    val referralCode: String,
    val pointsBalance: Int = 0,
    val lifetimePoints: Int = 0
)

@Serializable
data class SubmitTripsRequest(
    val trips: List<TripPayload>,
    val source: String = "android_app"
)

@Serializable
data class TripPayload(
    val tripUuid: String,
    val vehicleType: String? = null,
    val requestedAt: Long,
    val durationSeconds: Int? = null,
    val distanceMeters: Int? = null,
    val pickupDistrict: String? = null,
    val dropoffDistrict: String? = null,
    val currency: String,
    val fareAmount: Double,
    val serviceFee: Double = 0.0,
    val bookingFee: Double = 0.0,
    val tolls: Double = 0.0,
    val tips: Double = 0.0,
    val netEarnings: Double,
    val isPoolType: Boolean = false,
    val isSurge: Boolean = false,
    val uberPoints: Int? = null,
    val rawPayloadHash: String
)

@Serializable
data class SubmitTripsResponse(
    val processed: Int,
    val newTrips: Int,
    val duplicates: Int,
    val totalPointsAwarded: Int
)

@Serializable
data class SubmitActivityFeedRequest(
    val startDate: String,
    val endDate: String,
    val trips: List<ActivityItem>,
    val source: String = "android_app"
)

@Serializable
data class ActivityItem(
    val uuid: String,
    val activityTitle: String,
    val formattedTotal: String,
    val type: String
)

@Serializable
data class ActivityFeedResponse(
    val totalTrips: Int,
    val alreadySubmitted: Int,
    val newTripsToFetch: List<String>
)

@Serializable
data class BalanceResponse(
    val pointsBalance: Int,
    val lifetimePoints: Int,
    val referralCode: String
)

@Serializable
data class GiftCardsResponse(val giftCards: List<GiftCardItem>)

@Serializable
data class GiftCardItem(
    val id: String,
    val name: String,
    val provider: String,
    val pointsCost: Int,
    val faceValue: Double,
    val currency: String,
    val imageUrl: String? = null
)

@Serializable
data class RedeemRequest(val giftCardId: String)

@Serializable
data class RedeemResponse(
    val redemptionId: String,
    val status: String,
    val giftCardName: String,
    val pointsSpent: Int
)
