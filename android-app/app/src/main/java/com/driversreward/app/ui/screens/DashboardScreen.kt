package com.driversreward.app.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.driversreward.app.data.api.*
import com.driversreward.app.data.repository.AuthRepository
import com.driversreward.app.ui.theme.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import javax.inject.Inject

private const val TAG = "DashboardVM"

@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val api: RewardsApi,
    private val authRepository: AuthRepository
) : ViewModel() {
    private val _uiState = MutableStateFlow(DashboardUiState())
    val uiState: StateFlow<DashboardUiState> = _uiState.asStateFlow()

    init { loadData() }

    fun loadData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            var token = authRepository.getAccessToken()
            if (token == null) { _uiState.update { it.copy(isLoading = false, error = "Not authenticated") }; return@launch }
            try {
                var auth = "Bearer $token"
                var balanceRes = api.getBalance(auth)
                if (balanceRes.code() == 401) {
                    token = authRepository.refreshToken()
                    if (token == null) { _uiState.update { it.copy(isLoading = false, error = "Session expired") }; return@launch }
                    auth = "Bearer $token"; balanceRes = api.getBalance(auth)
                }

                val b = balanceRes.body()

                var driverName = ""
                var driverEmail = ""
                var driverRegion = ""
                var memberSince = ""
                var profileReferral = ""
                try {
                    val profileRes = api.getProfile(auth)
                    if (profileRes.isSuccessful) {
                        val p = profileRes.body()
                        driverName = p?.name ?: ""
                        driverEmail = p?.email ?: ""
                        driverRegion = p?.region ?: ""
                        memberSince = p?.createdAt ?: ""
                        profileReferral = p?.referralCode ?: ""
                    }
                } catch (e: Exception) { Log.e(TAG, "Profile fetch error: ${e.message}") }

                val cardsRes = api.getGiftCards(auth)
                val redemptionsRes = api.getRedemptions(auth)

                _uiState.update {
                    it.copy(
                        isLoading = false,
                        pointsBalance = b?.pointsBalance ?: 0,
                        lifetimePoints = b?.lifetimePoints ?: 0,
                        monthToDate = b?.monthToDate ?: 0,
                        monthlyBreakdown = b?.monthlyBreakdown ?: emptyList(),
                        syncWindow = b?.syncWindow,
                        referralCode = b?.referralCode ?: profileReferral,
                        driverName = driverName,
                        driverEmail = driverEmail,
                        driverRegion = driverRegion,
                        memberSince = memberSince,
                        giftCards = cardsRes.body()?.giftCards ?: emptyList(),
                        redemptions = redemptionsRes.body()?.redemptions ?: emptyList()
                    )
                }
            } catch (e: Exception) {
                Log.e(TAG, "loadData error: ${e.message}", e)
                _uiState.update { it.copy(isLoading = false, error = e.message) }
            }
        }
    }

    fun redeem(card: GiftCardItem) {
        viewModelScope.launch {
            _uiState.update { it.copy(isRedeeming = true, error = null, redeemSuccess = null) }
            var token = authRepository.getAccessToken() ?: return@launch
            try {
                var res = api.redeemGiftCard("Bearer $token", RedeemRequest(card.id))
                if (res.code() == 401) { token = authRepository.refreshToken() ?: return@launch; res = api.redeemGiftCard("Bearer $token", RedeemRequest(card.id)) }
                if (res.isSuccessful) { _uiState.update { it.copy(isRedeeming = false, redeemSuccess = "Redeemed ${card.name}!") }; loadData() }
                else {
                    val err = try { org.json.JSONObject(res.errorBody()?.string() ?: "").optString("error", "Failed") } catch (_: Exception) { "Failed" }
                    _uiState.update { it.copy(isRedeeming = false, error = err) }
                }
            } catch (e: Exception) { _uiState.update { it.copy(isRedeeming = false, error = e.message) } }
        }
    }

    fun dismissMessages() = _uiState.update { it.copy(error = null, redeemSuccess = null) }
    fun logout(onLogout: () -> Unit) { viewModelScope.launch { authRepository.logout(); onLogout() } }
}

data class DashboardUiState(
    val isLoading: Boolean = false, val isRedeeming: Boolean = false,
    val pointsBalance: Int = 0, val lifetimePoints: Int = 0, val monthToDate: Int = 0,
    val referralCode: String = "",
    val monthlyBreakdown: List<MonthlyEarning> = emptyList(),
    val syncWindow: SyncWindowResponse? = null,
    val driverName: String = "", val driverEmail: String = "", val driverRegion: String = "", val memberSince: String = "",
    val giftCards: List<GiftCardItem> = emptyList(), val redemptions: List<RedemptionItem> = emptyList(),
    val error: String? = null, val redeemSuccess: String? = null
)

@Composable
fun DashboardScreen(
    onNavigateToUber: () -> Unit, onLogout: () -> Unit,
    viewModel: DashboardViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    var selectedTab by remember { mutableIntStateOf(0) }
    var showRedeemConfirm by remember { mutableStateOf<GiftCardItem?>(null) }

    Scaffold(
        containerColor = Gray50,
        bottomBar = {
            NavigationBar(containerColor = White, tonalElevation = 2.dp) {
                NavigationBarItem(selected = selectedTab == 0, onClick = { selectedTab = 0 },
                    icon = { Icon(Icons.Default.Home, null) }, label = { Text("Home") })
                NavigationBarItem(selected = selectedTab == 1, onClick = { selectedTab = 1 },
                    icon = { Icon(Icons.Default.ShoppingCart, null) }, label = { Text("Rewards") })
                NavigationBarItem(selected = selectedTab == 2, onClick = { selectedTab = 2 },
                    icon = { Icon(Icons.Default.Person, null) }, label = { Text("Profile") })
            }
        }
    ) { padding ->
        when (selectedTab) {
            0 -> HomeTab(uiState, padding, onNavigateToUber, { viewModel.loadData() }, { viewModel.dismissMessages() })
            1 -> RewardsTab(uiState, padding, { showRedeemConfirm = it }, { viewModel.dismissMessages() })
            2 -> ProfileTab(uiState, padding, onLogout = { viewModel.logout(onLogout) })
        }
    }

    if (showRedeemConfirm != null) {
        val card = showRedeemConfirm!!
        AlertDialog(
            onDismissRequest = { showRedeemConfirm = null },
            title = { Text("Redeem ${card.name}?") },
            text = { Text("This will deduct ${card.pointsCost} points for a ${card.currency} ${card.faceValue.toInt()} gift card.") },
            confirmButton = { Button(onClick = { viewModel.redeem(card); showRedeemConfirm = null }) { Text("Confirm") } },
            dismissButton = { TextButton(onClick = { showRedeemConfirm = null }) { Text("Cancel") } }
        )
    }
}

// ═══════════════ HOME TAB ═══════════════

@Composable
fun HomeTab(s: DashboardUiState, padding: PaddingValues, onSync: () -> Unit, onRefresh: () -> Unit, onDismiss: () -> Unit) {
    LazyColumn(modifier = Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // Sync Window Banner
        item { SyncWindowCard(s.syncWindow) }

        // Points Balance
        item {
            Card(shape = RoundedCornerShape(20.dp), colors = CardDefaults.cardColors(containerColor = Indigo600)) {
                Column(modifier = Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Points Balance", color = White.copy(alpha = 0.8f), fontSize = 13.sp)
                    Spacer(Modifier.height(4.dp))
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text("${s.pointsBalance}", fontSize = 48.sp, fontWeight = FontWeight.Bold, color = White)
                        Text(" pts", fontSize = 16.sp, color = White.copy(alpha = 0.7f), modifier = Modifier.padding(bottom = 8.dp))
                    }
                }
            }
        }

        // Stats Row: This Month + Lifetime
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StatMiniCard("This Month", "${s.monthToDate}", Modifier.weight(1f))
                StatMiniCard("Lifetime", "${s.lifetimePoints}", Modifier.weight(1f))
            }
        }

        // Sync Button
        item {
            Button(onClick = onSync, modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(14.dp)) {
                Icon(Icons.Default.PlayArrow, null, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                Text("Sync Uber Trips", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            }
        }

        item {
            OutlinedButton(onClick = onRefresh, modifier = Modifier.fillMaxWidth().height(44.dp), shape = RoundedCornerShape(12.dp)) {
                Icon(Icons.Default.Refresh, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Refresh Data")
            }
        }

        if (s.redeemSuccess != null) { item { MessageBanner(s.redeemSuccess, Emerald500, Emerald50, Icons.Default.CheckCircle, onDismiss) } }
        if (s.error != null) { item { MessageBanner(s.error, Rose500, Color(0xFFFEF2F2), Icons.Default.Warning, onDismiss) } }

        // Monthly Breakdown (collapsible)
        if (s.monthlyBreakdown.isNotEmpty()) {
            item { MonthlyEarningsCard(s.monthlyBreakdown) }
        }

        if (s.isLoading) { item { Box(Modifier.fillMaxWidth().padding(32.dp), Alignment.Center) { CircularProgressIndicator() } } }
    }
}

@Composable
fun SyncWindowCard(sw: SyncWindowResponse?) {
    if (sw == null) return

    val isOpen = sw.inWindow
    val containerColor = if (isOpen) Emerald50 else Color(0xFFFFFBEB)
    val accentColor = if (isOpen) Emerald500 else Amber500
    val accentDim = accentColor.copy(alpha = 0.7f)

    Card(
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = containerColor)
    ) {
        Row(
            Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                Modifier
                    .size(40.dp)
                    .background(accentColor.copy(alpha = 0.12f), RoundedCornerShape(10.dp)),
                contentAlignment = Alignment.Center
            ) {
                Text(if (isOpen) "\uD83C\uDF1F" else "\uD83D\uDCC5", fontSize = 20.sp)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                if (isOpen) {
                    Text(
                        "Earn Points Now",
                        fontSize = 15.sp, fontWeight = FontWeight.Bold, color = accentColor
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        "Until ${formatWindowDate(sw.windowEnd)}",
                        fontSize = 12.sp, color = accentDim
                    )
                } else {
                    Text(
                        "Next Earning Window",
                        fontSize = 15.sp, fontWeight = FontWeight.Bold, color = accentColor
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        "${formatWindowDate(sw.nextWindowStart)} \u2013 ${formatWindowDate(sw.nextWindowEnd)}",
                        fontSize = 12.sp, fontWeight = FontWeight.Medium, color = accentColor
                    )
                    Spacer(Modifier.height(2.dp))
                    val relativeTime = formatRelativeTime(
                        Instant.parse(sw.nextWindowStart).toEpochMilli() - System.currentTimeMillis()
                    )
                    Text(
                        "Come back $relativeTime to earn points",
                        fontSize = 11.sp, color = accentDim
                    )
                }
            }
        }
    }
}

@Composable
fun MonthlyEarningsCard(breakdown: List<MonthlyEarning>) {
    var expanded by remember { mutableStateOf(false) }
    val preview = breakdown.take(3)
    val hasMore = breakdown.size > 3

    Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = White)) {
        Column(Modifier.padding(16.dp)) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Monthly Earnings", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Gray700)
                if (hasMore) {
                    TextButton(onClick = { expanded = !expanded }, contentPadding = PaddingValues(0.dp)) {
                        Text(
                            if (expanded) "Show less" else "Show all (${breakdown.size})",
                            fontSize = 12.sp, color = Indigo600
                        )
                    }
                }
            }
            Spacer(Modifier.height(6.dp))
            val items = if (expanded) breakdown else preview
            items.forEach { entry ->
                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(formatMonth(entry.month), fontSize = 13.sp, color = Gray500)
                    Text("+${entry.earned} pts", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Emerald500)
                }
            }
            if (!expanded && hasMore) {
                Spacer(Modifier.height(4.dp))
                Text("+ ${breakdown.size - 3} more months", fontSize = 11.sp, color = Gray400, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
            }
        }
    }
}

@Composable
fun StatMiniCard(label: String, value: String, modifier: Modifier = Modifier) {
    Card(shape = RoundedCornerShape(12.dp), colors = CardDefaults.cardColors(containerColor = White), modifier = modifier) {
        Column(Modifier.padding(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Gray900)
            Text(label, fontSize = 11.sp, color = Gray500)
        }
    }
}

// ═══════════════ REWARDS TAB ═══════════════

@Composable
fun RewardsTab(s: DashboardUiState, padding: PaddingValues, onRedeem: (GiftCardItem) -> Unit, onDismiss: () -> Unit) {
    var showHistory by remember { mutableStateOf(false) }

    LazyColumn(modifier = Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(if (!showHistory) "Gift Cards" else "Redemption History", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Gray900)
                TextButton(onClick = { showHistory = !showHistory }) {
                    Text(if (!showHistory) "History" else "Gift Cards", color = Indigo600, fontWeight = FontWeight.SemiBold)
                }
            }
        }

        if (s.redeemSuccess != null) { item { MessageBanner(s.redeemSuccess, Emerald500, Emerald50, Icons.Default.CheckCircle, onDismiss) } }
        if (s.error != null) { item { MessageBanner(s.error, Rose500, Color(0xFFFEF2F2), Icons.Default.Warning, onDismiss) } }

        if (!showHistory) {
            if (s.giftCards.isEmpty()) {
                item { EmptyState(Icons.Default.ShoppingCart, "No Gift Cards Yet", "Gift cards will appear here once available.") }
            } else {
                items(s.giftCards, key = { it.id }) { card -> GiftCardRow(card, s.pointsBalance, s.isRedeeming) { onRedeem(card) } }
            }
        } else {
            if (s.redemptions.isEmpty()) {
                item { EmptyState(Icons.Default.DateRange, "No Redemptions", "Your redemption history will appear here.") }
            } else {
                items(s.redemptions, key = { it.id }) { r -> RedemptionRow(r) }
            }
        }
    }
}

// ═══════════════ PROFILE TAB ═══════════════

@Composable
fun ProfileTab(s: DashboardUiState, padding: PaddingValues, onLogout: () -> Unit) {
    val context = LocalContext.current
    var copiedToast by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize().padding(padding).padding(20.dp)) {
        Spacer(Modifier.height(8.dp))
        Text("Profile", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Gray900)
        Spacer(Modifier.height(24.dp))

        Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = White)) {
            Column(modifier = Modifier.padding(16.dp)) {
                if (s.driverName.isNotEmpty()) {
                    ProfileRow("Name", s.driverName)
                    HorizontalDivider(color = Gray100, modifier = Modifier.padding(vertical = 12.dp))
                }
                ProfileRow("Email", s.driverEmail.ifEmpty { "\u2014" })
                HorizontalDivider(color = Gray100, modifier = Modifier.padding(vertical = 12.dp))
                ProfileRow("Region", when (s.driverRegion) { "HK" -> "Hong Kong \uD83C\uDDED\uD83C\uDDF0"; "BR" -> "Brazil \uD83C\uDDE7\uD83C\uDDF7"; else -> s.driverRegion.ifEmpty { "\u2014" } })
                HorizontalDivider(color = Gray100, modifier = Modifier.padding(vertical = 12.dp))
                ProfileRow("Member Since", formatDate(s.memberSince))
                HorizontalDivider(color = Gray100, modifier = Modifier.padding(vertical = 12.dp))
                ProfileRow("Lifetime Points", "${s.lifetimePoints}")
            }
        }

        Spacer(Modifier.height(16.dp))

        Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = White)) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("Your Referral Code", fontSize = 12.sp, color = Gray500, fontWeight = FontWeight.Medium)
                Spacer(Modifier.height(6.dp))
                Surface(shape = RoundedCornerShape(8.dp), color = Indigo50, modifier = Modifier.fillMaxWidth()) {
                    Text(
                        s.referralCode.ifEmpty { "N/A" },
                        fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Indigo700,
                        fontFamily = FontFamily.Monospace, textAlign = TextAlign.Center,
                        modifier = Modifier.padding(14.dp)
                    )
                }
                Spacer(Modifier.height(10.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(
                        onClick = {
                            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                            clipboard.setPrimaryClip(ClipData.newPlainText("Referral Code", s.referralCode))
                            copiedToast = true
                        },
                        modifier = Modifier.weight(1f).height(42.dp), shape = RoundedCornerShape(10.dp),
                        enabled = s.referralCode.isNotEmpty()
                    ) {
                        Icon(Icons.Default.Create, null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(if (copiedToast) "Copied!" else "Copy")
                    }
                    Button(
                        onClick = {
                            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                                type = "text/plain"
                                putExtra(Intent.EXTRA_TEXT, "Join DriversReward and earn points from your trips! Use my referral code: ${s.referralCode}\n\nDownload: https://driversreward.com")
                            }
                            context.startActivity(Intent.createChooser(shareIntent, "Share Referral Code"))
                        },
                        modifier = Modifier.weight(1f).height(42.dp), shape = RoundedCornerShape(10.dp),
                        enabled = s.referralCode.isNotEmpty()
                    ) {
                        Icon(Icons.Default.Share, null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Share")
                    }
                }
                Spacer(Modifier.height(4.dp))
                Text("Share this code to earn bonus points!", fontSize = 12.sp, color = Gray400)
            }
        }

        if (copiedToast) {
            LaunchedEffect(Unit) { delay(2000); copiedToast = false }
        }

        Spacer(Modifier.weight(1f))

        OutlinedButton(
            onClick = onLogout, modifier = Modifier.fillMaxWidth().height(48.dp),
            shape = RoundedCornerShape(12.dp), colors = ButtonDefaults.outlinedButtonColors(contentColor = Rose500)
        ) {
            Icon(Icons.AutoMirrored.Filled.ExitToApp, null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("Sign Out", fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
fun ProfileRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = Gray500, fontSize = 14.sp)
        Text(value, color = Gray900, fontSize = 14.sp, fontWeight = FontWeight.Medium)
    }
}

// ═══════════════ SHARED COMPONENTS ═══════════════

@Composable
fun MessageBanner(text: String, fgColor: Color, bgColor: Color, icon: ImageVector, onDismiss: () -> Unit) {
    Card(shape = RoundedCornerShape(12.dp), colors = CardDefaults.cardColors(containerColor = bgColor)) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, tint = fgColor, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(10.dp))
            Text(text, color = fgColor, fontSize = 13.sp, modifier = Modifier.weight(1f))
            IconButton(onClick = onDismiss, modifier = Modifier.size(20.dp)) { Icon(Icons.Default.Close, null, tint = fgColor, modifier = Modifier.size(14.dp)) }
        }
    }
}

@Composable
fun GiftCardRow(card: GiftCardItem, balance: Int, isRedeeming: Boolean, onRedeem: () -> Unit) {
    val canAfford = balance >= card.pointsCost
    Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = White)) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(44.dp).background(Indigo50, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                Icon(Icons.Default.ShoppingCart, null, tint = Indigo600, modifier = Modifier.size(22.dp))
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(card.name, color = Gray900, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${card.currency} ${card.faceValue.toInt()}", color = Gray500, fontSize = 13.sp)
            }
            Spacer(Modifier.width(10.dp))
            Button(onClick = onRedeem, enabled = canAfford && !isRedeeming, shape = RoundedCornerShape(10.dp),
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp)) {
                Text("${card.pointsCost} pts", fontWeight = FontWeight.Bold, fontSize = 13.sp)
            }
        }
    }
}

@Composable
fun RedemptionRow(r: RedemptionItem) {
    val context = LocalContext.current
    var codeCopied by remember { mutableStateOf(false) }

    val (statusColor, statusBg, statusLabel) = when (r.status.uppercase()) {
        "FULFILLED" -> Triple(Emerald500, Emerald50, "Gift Code Sent")
        "PROCESSING" -> Triple(Color(0xFF3B82F6), Color(0xFFDBEAFE), "Under Review")
        "PENDING" -> Triple(Amber500, Color(0xFFFFFBEB), "Request Sent")
        "CANCELLED" -> Triple(Rose500, Color(0xFFFEF2F2), "Cancelled")
        "FAILED" -> Triple(Rose500, Color(0xFFFEF2F2), "Failed")
        else -> Triple(Gray500, Gray100, r.status)
    }
    Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = White)) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(r.giftCardName, color = Gray900, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    Text("${r.pointsSpent} pts", color = Gray500, fontSize = 12.sp)
                }
                Surface(shape = RoundedCornerShape(8.dp), color = statusBg) {
                    Text(statusLabel, color = statusColor, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
                }
            }

            if (!r.giftCardCode.isNullOrEmpty()) {
                Spacer(Modifier.height(10.dp))
                Surface(shape = RoundedCornerShape(8.dp), color = Emerald50, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Text("Your Gift Card Code", fontSize = 11.sp, color = Emerald600, fontWeight = FontWeight.Medium)
                        Spacer(Modifier.height(6.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                r.giftCardCode, color = Emerald600, fontFamily = FontFamily.Monospace,
                                fontWeight = FontWeight.Bold, fontSize = 16.sp, letterSpacing = 1.sp,
                                modifier = Modifier.weight(1f)
                            )
                            IconButton(
                                onClick = {
                                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                    clipboard.setPrimaryClip(ClipData.newPlainText("Gift Card Code", r.giftCardCode))
                                    codeCopied = true
                                },
                                modifier = Modifier.size(32.dp)
                            ) {
                                Icon(
                                    if (codeCopied) Icons.Default.Check else Icons.Default.Create,
                                    contentDescription = "Copy code",
                                    tint = Emerald600, modifier = Modifier.size(18.dp)
                                )
                            }
                        }
                    }
                }
                if (codeCopied) { LaunchedEffect(Unit) { delay(2000); codeCopied = false } }
            }

            if (r.status.uppercase() == "PENDING") {
                Spacer(Modifier.height(8.dp))
                Text("Our team will review and send you a gift card code soon.", fontSize = 11.sp, color = Amber500)
            }
            if (r.status.uppercase() == "CANCELLED" && !r.failureReason.isNullOrEmpty()) {
                Spacer(Modifier.height(8.dp))
                Text(r.failureReason, fontSize = 11.sp, color = Rose500)
            }

            Spacer(Modifier.height(6.dp))
            Text(formatDate(r.createdAt), color = Gray400, fontSize = 11.sp)
        }
    }
}

@Composable
fun EmptyState(icon: ImageVector, title: String, subtitle: String) {
    Column(Modifier.fillMaxWidth().padding(vertical = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(56.dp).background(Gray100, RoundedCornerShape(28.dp)), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = Gray400, modifier = Modifier.size(28.dp))
        }
        Spacer(Modifier.height(14.dp))
        Text(title, color = Gray600, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(4.dp))
        Text(subtitle, color = Gray400, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 40.dp))
    }
}

private fun formatDate(isoDate: String): String {
    if (isoDate.isBlank()) return "\u2014"
    return try {
        val instant = Instant.parse(isoDate)
        val local = instant.atZone(ZoneId.systemDefault())
        "${local.dayOfMonth} ${local.month.name.lowercase().replaceFirstChar { it.uppercase() }.take(3)} ${local.year}"
    } catch (_: Exception) { isoDate.take(10).ifEmpty { "\u2014" } }
}

private fun formatWindowDate(isoDate: String): String {
    return try {
        val instant = Instant.parse(isoDate)
        val local = instant.atZone(ZoneId.systemDefault())
        val dayOfWeek = local.dayOfWeek.name.lowercase().replaceFirstChar { it.uppercase() }.take(3)
        val month = local.month.name.lowercase().replaceFirstChar { it.uppercase() }.take(3)
        "$dayOfWeek $month ${local.dayOfMonth}, ${local.toLocalTime().toString().take(5)}"
    } catch (_: Exception) { isoDate.take(16) }
}

private fun formatMonth(monthStr: String): String {
    val names = arrayOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    return try {
        val (yr, mo) = monthStr.split("-")
        "${names[mo.toInt() - 1]} $yr"
    } catch (_: Exception) { monthStr }
}

private fun formatRelativeTime(ms: Long): String {
    if (ms <= 0) return "soon"
    val hours = ms / 3_600_000
    val days = hours / 24
    return when {
        days >= 2 -> "in $days days"
        days == 1L -> "in 1 day"
        hours >= 2 -> "in $hours hours"
        hours == 1L -> "in about an hour"
        else -> "in less than an hour"
    }
}
