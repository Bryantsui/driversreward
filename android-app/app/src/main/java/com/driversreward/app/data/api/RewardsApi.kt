package com.driversreward.app.data.api

import retrofit2.Response
import retrofit2.http.*

interface RewardsApi {

    @POST("api/auth/login")
    suspend fun login(@Body request: LoginRequest): Response<AuthResponse>

    @POST("api/auth/register")
    suspend fun register(@Body request: RegisterRequest): Response<AuthResponse>

    @POST("api/auth/refresh")
    suspend fun refreshToken(@Body request: RefreshRequest): Response<TokenResponse>

    @POST("api/auth/forgot-password")
    suspend fun forgotPassword(@Body request: ForgotPasswordRequest): Response<ForgotPasswordResponse>

    @POST("api/auth/reset-password")
    suspend fun resetPassword(@Body request: ResetPasswordRequest): Response<ResetPasswordResponse>

    @POST("api/ingest/trips")
    suspend fun submitTrips(
        @Header("Authorization") token: String,
        @Body request: SubmitTripsRequest
    ): Response<SubmitTripsResponse>

    @POST("api/ingest/raw-trips")
    suspend fun submitRawTrips(
        @Header("Authorization") token: String,
        @Body request: SubmitRawTripsRequest
    ): Response<SubmitRawTripsResponse>

    @POST("api/ingest/activity-feed")
    suspend fun submitActivityFeed(
        @Header("Authorization") token: String,
        @Body request: SubmitActivityFeedRequest
    ): Response<ActivityFeedResponse>

    @POST("api/ingest/raw-bonuses")
    suspend fun submitRawBonuses(
        @Header("Authorization") token: String,
        @Body request: SubmitRawBonusesRequest
    ): Response<SubmitRawBonusesResponse>

    @GET("api/rewards/balance")
    suspend fun getBalance(@Header("Authorization") token: String): Response<BalanceResponse>

    @GET("api/driver/me")
    suspend fun getProfile(@Header("Authorization") token: String): Response<ProfileResponse>

    @GET("api/rewards/gift-cards")
    suspend fun getGiftCards(@Header("Authorization") token: String): Response<GiftCardsResponse>

    @POST("api/rewards/redeem")
    suspend fun redeemGiftCard(
        @Header("Authorization") token: String,
        @Body request: RedeemRequest
    ): Response<RedeemResponse>

    @GET("api/rewards/redemptions")
    suspend fun getRedemptions(
        @Header("Authorization") token: String,
        @Query("limit") limit: Int = 20
    ): Response<RedemptionsResponse>

    @POST("api/session/store-credential")
    suspend fun storeCredential(
        @Header("Authorization") token: String,
        @Body body: Map<String, String>
    ): Response<Map<String, String>>

    @GET("api/session/credential-status")
    suspend fun getCredentialStatus(
        @Header("Authorization") token: String
    ): Response<CredentialStatusResponse>

    @POST("api/session/trigger-scrape")
    suspend fun triggerScrape(
        @Header("Authorization") token: String
    ): Response<TriggerScrapeResponse>
}


data class LoginRequest(val phone: String, val password: String)


data class RegisterRequest(
    val phone: String,
    val password: String,
    val name: String,
    val email: String? = null,
    val region: String,
    val referralCode: String? = null,
    val consentDataCollection: Boolean = true
)


data class RefreshRequest(val refreshToken: String)


data class AuthResponse(
    val driver: DriverInfo,
    val accessToken: String,
    val refreshToken: String
)


data class TokenResponse(val accessToken: String, val refreshToken: String)


data class DriverInfo(
    val id: String,
    val phone: String = "",
    val email: String? = null,
    val region: String,
    val referralCode: String,
    val pointsBalance: Int = 0,
    val lifetimePoints: Int = 0
)


data class SubmitTripsRequest(
    val trips: List<TripPayload>,
    val source: String = "android_app"
)


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


data class SubmitTripsResponse(
    val processed: Int,
    val newTrips: Int,
    val duplicates: Int,
    val totalPointsAwarded: Int
)


data class SubmitActivityFeedRequest(
    val startDate: String,
    val endDate: String,
    val trips: List<ActivityItem>,
    val source: String = "android_app"
)


data class ActivityItem(
    val uuid: String,
    val activityTitle: String,
    val formattedTotal: String,
    val type: String
)


data class ActivityFeedResponse(
    val totalTrips: Int,
    val alreadySubmitted: Int,
    val newTripsToFetch: List<String>
)


data class BalanceResponse(
    val pointsBalance: Int,
    val lifetimePoints: Int,
    val referralCode: String,
    val monthToDate: Int = 0,
    val monthlyBreakdown: List<MonthlyEarning> = emptyList(),
    val syncWindow: SyncWindowResponse? = null
)

data class MonthlyEarning(
    val month: String,
    val earned: Int
)

data class SyncWindowResponse(
    val inWindow: Boolean,
    val windowStart: String,
    val windowEnd: String,
    val nextWindowStart: String,
    val nextWindowEnd: String
)

data class ProfileResponse(
    val id: String? = null,
    val name: String? = null,
    val phone: String? = null,
    val email: String? = null,
    val region: String? = null,
    val pointsBalance: Int = 0,
    val lifetimePoints: Int = 0,
    val referralCode: String? = null,
    val createdAt: String? = null
)


data class GiftCardsResponse(val giftCards: List<GiftCardItem>)


data class GiftCardItem(
    val id: String,
    val name: String,
    val provider: String,
    val pointsCost: Int,
    val faceValue: Double,
    val currency: String,
    val imageUrl: String? = null
)


data class RedeemRequest(val giftCardId: String)


data class RedeemResponse(
    val redemptionId: String,
    val status: String,
    val giftCardName: String,
    val pointsSpent: Int
)

data class RawTripItem(
    val rawBody: String,
    val tripUuid: String = "",
    val url: String = ""
)

data class SubmitRawTripsRequest(
    val trips: List<RawTripItem>,
    val source: String = "android_app"
)

data class SubmitRawTripsResponse(
    val processed: Int,
    val created: Int,
    val duplicates: Int,
    val errors: Int,
    val totalPointsAwarded: Int
)

data class ForgotPasswordRequest(val phone: String)

data class ForgotPasswordResponse(
    val message: String,
    val _resetCode: String? = null
)

data class ResetPasswordRequest(
    val phone: String,
    val code: String,
    val newPassword: String
)

data class ResetPasswordResponse(val message: String)

data class CredentialStatusResponse(
    val hasCredential: Boolean = false,
    val isValid: Boolean = false,
    val serverScrapeAvailable: Boolean = false,
    val capturedAt: String? = null,
    val expiresAt: String? = null
)

data class TriggerScrapeResponse(
    val status: String = "",
    val scrapeJobId: String? = null
)

data class RedemptionsResponse(val redemptions: List<RedemptionItem>, val total: Int)

data class RedemptionItem(
    val id: String,
    val giftCardName: String = "Gift Card",
    val pointsSpent: Int = 0,
    val status: String = "PENDING",
    val giftCardCode: String? = null,
    val failureReason: String? = null,
    val createdAt: String = "",
    val fulfilledAt: String? = null
)

data class BonusItem(
    val uuid: String,
    val activityType: String,
    val activityTitle: String,
    val formattedTotal: String,
    val recognizedAt: Long,
    val formattedDate: String? = null,
    val description: String? = null,
    val eventType: String? = null,
    val incentiveUuid: String? = null,
    val rawPayload: Any? = null
)

data class SubmitRawBonusesRequest(
    val bonuses: List<BonusItem>,
    val source: String = "android_app"
)

data class SubmitRawBonusesResponse(
    val processed: Int,
    val created: Int,
    val duplicates: Int
)
