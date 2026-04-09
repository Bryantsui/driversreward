package com.driversreward.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.driversreward.app.data.repository.AuthRepository
import com.driversreward.app.ui.theme.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class RegisterViewModel @Inject constructor(
    private val authRepository: AuthRepository
) : ViewModel() {
    private val _uiState = MutableStateFlow(RegisterUiState())
    val uiState: StateFlow<RegisterUiState> = _uiState.asStateFlow()

    fun updateField(field: String, value: String) {
        _uiState.update { state ->
            when (field) {
                "name" -> state.copy(name = value, error = null)
                "phone" -> state.copy(phone = value.filter { it.isDigit() }, error = null)
                "email" -> state.copy(email = value, error = null)
                "password" -> state.copy(password = value, error = null)
                "region" -> {
                    val cc = if (value == "HK") "+852" else "+55"
                    state.copy(region = value, countryCode = cc, error = null)
                }
                "referralCode" -> state.copy(referralCode = value, error = null)
                else -> state
            }
        }
    }

    fun register(onSuccess: () -> Unit) {
        val state = _uiState.value
        if (state.phone.isBlank() || state.password.isBlank() || state.name.isBlank()) {
            _uiState.update { it.copy(error = "Please fill all required fields") }
            return
        }
        val fullPhone = "${state.countryCode}${state.phone}"
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            val result = authRepository.register(
                phone = fullPhone, password = state.password,
                name = state.name.trim(), region = state.region,
                email = state.email.trim().takeIf { it.isNotBlank() },
                referralCode = state.referralCode.takeIf { it.isNotBlank() }
            )
            _uiState.update { it.copy(isLoading = false) }
            if (result.isSuccess) onSuccess()
            else _uiState.update { it.copy(error = result.exceptionOrNull()?.message ?: "Registration failed") }
        }
    }
}

data class RegisterUiState(
    val name: String = "",
    val phone: String = "",
    val email: String = "",
    val password: String = "",
    val region: String = "HK",
    val countryCode: String = "+852",
    val referralCode: String = "",
    val isLoading: Boolean = false,
    val error: String? = null
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RegisterScreen(
    onNavigateToLogin: () -> Unit,
    onRegisterSuccess: () -> Unit,
    viewModel: RegisterViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val focusManager = LocalFocusManager.current
    var countryDropdownExpanded by remember { mutableStateOf(false) }
    val selectedCountry = COUNTRY_CODES.find { it.code == uiState.countryCode } ?: COUNTRY_CODES[0]

    Column(
        modifier = Modifier.fillMaxSize().background(White).padding(horizontal = 28.dp).verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(modifier = Modifier.height(60.dp))
        Text("Create Account", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Indigo700)
        Text("Join DriversReward today", fontSize = 14.sp, color = Gray500)
        Spacer(modifier = Modifier.height(28.dp))

        OutlinedTextField(
            value = uiState.name, onValueChange = { viewModel.updateField("name", it) },
            label = { Text("Full Name") }, leadingIcon = { Icon(Icons.Outlined.Person, null, tint = Gray400) },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
            keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
            modifier = Modifier.fillMaxWidth(), singleLine = true, shape = RoundedCornerShape(12.dp),
        )
        Spacer(modifier = Modifier.height(12.dp))

        Text("Select Region", color = Gray600, fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.fillMaxWidth())
        Spacer(modifier = Modifier.height(8.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            listOf("HK" to "Hong Kong \uD83C\uDDED\uD83C\uDDF0", "BR" to "Brazil \uD83C\uDDE7\uD83C\uDDF7").forEach { (code, label) ->
                FilterChip(
                    selected = uiState.region == code,
                    onClick = { viewModel.updateField("region", code) },
                    label = { Text(label) },
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(10.dp),
                )
            }
        }
        Spacer(modifier = Modifier.height(12.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Bottom
        ) {
            ExposedDropdownMenuBox(
                expanded = countryDropdownExpanded,
                onExpandedChange = { countryDropdownExpanded = !countryDropdownExpanded },
                modifier = Modifier.width(110.dp)
            ) {
                OutlinedTextField(
                    value = "${selectedCountry.flag} ${selectedCountry.code}",
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Code") },
                    modifier = Modifier.menuAnchor().width(110.dp),
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    textStyle = LocalTextStyle.current.copy(fontSize = 14.sp),
                )
                ExposedDropdownMenu(
                    expanded = countryDropdownExpanded,
                    onDismissRequest = { countryDropdownExpanded = false }
                ) {
                    COUNTRY_CODES.forEach { cc ->
                        DropdownMenuItem(
                            text = { Text("${cc.flag} ${cc.code} ${cc.label}") },
                            onClick = {
                                viewModel.updateField("region", if (cc.code == "+852") "HK" else "BR")
                                countryDropdownExpanded = false
                            }
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.width(8.dp))

            OutlinedTextField(
                value = uiState.phone, onValueChange = { viewModel.updateField("phone", it) },
                label = { Text("Phone number") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Next),
                keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
                modifier = Modifier.weight(1f), singleLine = true, shape = RoundedCornerShape(12.dp),
            )
        }
        Spacer(modifier = Modifier.height(12.dp))

        OutlinedTextField(
            value = uiState.email, onValueChange = { viewModel.updateField("email", it) },
            label = { Text("Email (optional)") }, leadingIcon = { Icon(Icons.Outlined.Email, null, tint = Gray400) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
            keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
            modifier = Modifier.fillMaxWidth(), singleLine = true, shape = RoundedCornerShape(12.dp),
        )
        Spacer(modifier = Modifier.height(12.dp))

        OutlinedTextField(
            value = uiState.password, onValueChange = { viewModel.updateField("password", it) },
            label = { Text("Password") }, leadingIcon = { Icon(Icons.Outlined.Lock, null, tint = Gray400) },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { focusManager.clearFocus() }),
            modifier = Modifier.fillMaxWidth(), singleLine = true, shape = RoundedCornerShape(12.dp),
        )
        Spacer(modifier = Modifier.height(12.dp))

        OutlinedTextField(
            value = uiState.referralCode, onValueChange = { viewModel.updateField("referralCode", it) },
            label = { Text("Referral Code (optional)") },
            modifier = Modifier.fillMaxWidth(), singleLine = true, shape = RoundedCornerShape(12.dp),
        )

        if (uiState.error != null) {
            Spacer(modifier = Modifier.height(12.dp))
            Text(uiState.error!!, color = Rose500, fontSize = 13.sp)
        }

        Spacer(modifier = Modifier.height(24.dp))

        Button(
            onClick = { viewModel.register(onRegisterSuccess) },
            modifier = Modifier.fillMaxWidth().height(52.dp),
            enabled = !uiState.isLoading, shape = RoundedCornerShape(12.dp),
        ) {
            if (uiState.isLoading) CircularProgressIndicator(modifier = Modifier.size(22.dp), color = White, strokeWidth = 2.dp)
            else Text("Create Account", fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
        }

        Spacer(modifier = Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Already have an account? ", color = Gray500, fontSize = 14.sp)
            TextButton(onClick = onNavigateToLogin, contentPadding = PaddingValues(0.dp)) {
                Text("Sign In", color = Indigo600, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            }
        }
        Spacer(modifier = Modifier.height(40.dp))
    }
}
