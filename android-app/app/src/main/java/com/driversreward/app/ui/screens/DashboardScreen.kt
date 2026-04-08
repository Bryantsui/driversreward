package com.driversreward.app.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExitToApp
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.driversreward.app.data.api.GiftCardItem
import com.driversreward.app.data.api.RewardsApi
import com.driversreward.app.data.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val api: RewardsApi,
    private val authRepository: AuthRepository
) : ViewModel() {
    private val _uiState = MutableStateFlow(DashboardUiState())
    val uiState: StateFlow<DashboardUiState> = _uiState.asStateFlow()

    init {
        loadData()
    }

    fun loadData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            val token = authRepository.getAccessToken()
            if (token == null) {
                _uiState.update { it.copy(isLoading = false, error = "Not authenticated") }
                return@launch
            }

            try {
                val authHeader = "Bearer $token"
                val balanceRes = api.getBalance(authHeader)
                val cardsRes = api.getGiftCards(authHeader)

                if (balanceRes.isSuccessful && cardsRes.isSuccessful) {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            pointsBalance = balanceRes.body()?.pointsBalance ?: 0,
                            lifetimePoints = balanceRes.body()?.lifetimePoints ?: 0,
                            giftCards = cardsRes.body()?.giftCards ?: emptyList()
                        )
                    }
                } else {
                    _uiState.update { it.copy(isLoading = false, error = "Failed to load data") }
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoading = false, error = e.message) }
            }
        }
    }

    fun redeem(giftCardId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isRedeeming = true, error = null, redeemSuccess = null) }
            val token = authRepository.getAccessToken() ?: return@launch
            
            try {
                val res = api.redeemGiftCard("Bearer $token", com.driversreward.app.data.api.RedeemRequest(giftCardId))
                if (res.isSuccessful) {
                    _uiState.update { it.copy(isRedeeming = false, redeemSuccess = "Redemption successful! Check your email.") }
                    loadData() // Refresh balance
                } else {
                    _uiState.update { it.copy(isRedeeming = false, error = res.errorBody()?.string() ?: "Redemption failed") }
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(isRedeeming = false, error = e.message) }
            }
        }
    }

    fun logout(onLogout: () -> Unit) {
        viewModelScope.launch {
            authRepository.logout()
            onLogout()
        }
    }
}

data class DashboardUiState(
    val isLoading: Boolean = false,
    val isRedeeming: Boolean = false,
    val pointsBalance: Int = 0,
    val lifetimePoints: Int = 0,
    val giftCards: List<GiftCardItem> = emptyList(),
    val error: String? = null,
    val redeemSuccess: String? = null
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    onNavigateToUber: () -> Unit,
    onLogout: () -> Unit,
    viewModel: DashboardViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("DriversReward") },
                actions = {
                    IconButton(onClick = { viewModel.loadData() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                    IconButton(onClick = { viewModel.logout(onLogout) }) {
                        Icon(Icons.Default.ExitToApp, contentDescription = "Logout")
                    }
                }
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = onNavigateToUber,
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary
            ) {
                Text("Open Uber Portal")
            }
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp)
        ) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
            ) {
                Column(
                    modifier = Modifier.padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text("Your Balance", style = MaterialTheme.typography.titleMedium)
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "${uiState.pointsBalance} pts",
                        style = MaterialTheme.typography.displayLarge,
                        fontWeight = FontWeight.Bold
                    )
                    Text("Lifetime: ${uiState.lifetimePoints} pts", style = MaterialTheme.typography.bodyMedium)
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            if (uiState.error != null) {
                Text(uiState.error!!, color = MaterialTheme.colorScheme.error)
                Spacer(modifier = Modifier.height(8.dp))
            }
            if (uiState.redeemSuccess != null) {
                Text(uiState.redeemSuccess!!, color = MaterialTheme.colorScheme.primary)
                Spacer(modifier = Modifier.height(8.dp))
            }

            Text("Available Rewards", style = MaterialTheme.typography.titleLarge)
            Spacer(modifier = Modifier.height(16.dp))

            if (uiState.isLoading) {
                CircularProgressIndicator(modifier = Modifier.align(Alignment.CenterHorizontally))
            } else {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxSize()
                ) {
                    items(uiState.giftCards) { card ->
                        GiftCardItemRow(
                            card = card,
                            canAfford = uiState.pointsBalance >= card.pointsCost,
                            isRedeeming = uiState.isRedeeming,
                            onRedeem = { viewModel.redeem(card.id) }
                        )
                    }
                    item { Spacer(modifier = Modifier.height(80.dp)) } // Space for FAB
                }
            }
        }
    }
}

@Composable
fun GiftCardItemRow(
    card: GiftCardItem,
    canAfford: Boolean,
    isRedeeming: Boolean,
    onRedeem: () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .padding(16.dp)
                .fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(card.name, style = MaterialTheme.typography.titleMedium)
                Text("${card.provider} • ${card.currency} ${card.faceValue}", style = MaterialTheme.typography.bodyMedium)
            }
            Button(
                onClick = onRedeem,
                enabled = canAfford && !isRedeeming
            ) {
                Text("${card.pointsCost} pts")
            }
        }
    }
}
