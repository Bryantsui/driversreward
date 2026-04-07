package com.uberdriverrewards.data.repository

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import com.uberdriverrewards.data.api.*
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
        val EMAIL = stringPreferencesKey("email")
    }

    suspend fun login(email: String, password: String): Result<AuthResponse> {
        return try {
            val response = api.login(LoginRequest(email, password))
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
        email: String,
        password: String,
        name: String,
        region: String,
        referralCode: String? = null
    ): Result<AuthResponse> {
        return try {
            val response = api.register(
                RegisterRequest(
                    email = email,
                    password = password,
                    name = name,
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
            prefs[EMAIL] = auth.driver.email
        }
    }
}
