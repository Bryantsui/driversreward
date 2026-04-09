package com.driversreward.app.data.repository

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import com.driversreward.app.data.api.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val api: RewardsApi,
    private val dataStore: DataStore<Preferences>
) {
    companion object {
        val ACCESS_TOKEN = stringPreferencesKey("access_token")
        val REFRESH_TOKEN = stringPreferencesKey("refresh_token")
        val DRIVER_ID = stringPreferencesKey("driver_id")
        val REGION = stringPreferencesKey("region")
        val PHONE = stringPreferencesKey("phone")
    }

    suspend fun login(phone: String, password: String): Result<AuthResponse> {
        return try {
            val response = api.login(LoginRequest(phone, password))
            if (response.isSuccessful && response.body() != null) {
                val auth = response.body()!!
                saveAuth(auth)
                Result.success(auth)
            } else {
                Result.failure(Exception(response.errorBody()?.string() ?: "Login failed"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun register(
        phone: String,
        password: String,
        name: String,
        region: String,
        email: String? = null,
        referralCode: String? = null
    ): Result<AuthResponse> {
        return try {
            val response = api.register(
                RegisterRequest(
                    phone = phone,
                    password = password,
                    name = name,
                    email = email,
                    region = region,
                    referralCode = referralCode
                )
            )
            if (response.isSuccessful && response.body() != null) {
                val auth = response.body()!!
                saveAuth(auth)
                Result.success(auth)
            } else {
                Result.failure(Exception(response.errorBody()?.string() ?: "Registration failed"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getAccessToken(): String? {
        return dataStore.data.map { it[ACCESS_TOKEN] }.first()
    }

    suspend fun refreshToken(): String? {
        val refresh = dataStore.data.map { it[REFRESH_TOKEN] }.first() ?: return null

        return try {
            val response = api.refreshToken(RefreshRequest(refresh))
            if (response.isSuccessful && response.body() != null) {
                val tokens = response.body()!!
                dataStore.edit { prefs ->
                    prefs[ACCESS_TOKEN] = tokens.accessToken
                    prefs[REFRESH_TOKEN] = tokens.refreshToken
                }
                tokens.accessToken
            } else {
                null
            }
        } catch (_: Exception) {
            null
        }
    }

    suspend fun forgotPassword(phone: String): Result<String?> {
        return try {
            val response = api.forgotPassword(ForgotPasswordRequest(phone))
            if (response.isSuccessful && response.body() != null) {
                Result.success(response.body()!!._resetCode)
            } else {
                Result.failure(Exception(response.errorBody()?.string() ?: "Request failed"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun resetPassword(phone: String, code: String, newPassword: String): Result<String> {
        return try {
            val response = api.resetPassword(ResetPasswordRequest(phone, code, newPassword))
            if (response.isSuccessful && response.body() != null) {
                Result.success(response.body()!!.message)
            } else {
                Result.failure(Exception(response.errorBody()?.string() ?: "Reset failed"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun isLoggedIn(): Boolean {
        return dataStore.data.map { it[ACCESS_TOKEN] }.first() != null
    }

    suspend fun logout() {
        dataStore.edit { it.clear() }
    }

    private suspend fun saveAuth(auth: AuthResponse) {
        dataStore.edit { prefs ->
            prefs[ACCESS_TOKEN] = auth.accessToken
            prefs[REFRESH_TOKEN] = auth.refreshToken
            prefs[DRIVER_ID] = auth.driver.id
            prefs[REGION] = auth.driver.region
            prefs[PHONE] = auth.driver.phone
        }
    }
}
