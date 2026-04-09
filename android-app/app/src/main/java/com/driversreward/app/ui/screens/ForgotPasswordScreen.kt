package com.driversreward.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
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
class ForgotPasswordViewModel @Inject constructor(
    private val authRepository: AuthRepository
) : ViewModel() {
    private val _uiState = MutableStateFlow(ForgotPasswordUiState())
    val uiState: StateFlow<ForgotPasswordUiState> = _uiState.asStateFlow()

    fun onPhoneChange(v: String) = _uiState.update { it.copy(phone = v.filter { c -> c.isDigit() || c == '+' }, error = null) }
    fun onCountryCodeChange(v: String) = _uiState.update { it.copy(countryCode = v, error = null) }
    fun onCodeChange(v: String) = _uiState.update { it.copy(code = v, error = null) }
    fun onNewPasswordChange(v: String) = _uiState.update { it.copy(newPassword = v, error = null) }
    fun onConfirmPasswordChange(v: String) = _uiState.update { it.copy(confirmPassword = v, error = null) }

    fun sendCode() {
        val state = _uiState.value
        val phone = state.phone.filter { it.isDigit() }
        if (phone.isBlank()) { _uiState.update { it.copy(error = "Please enter your phone number") }; return }
        val fullPhone = "${state.countryCode}$phone"
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            val result = authRepository.forgotPassword(fullPhone)
            _uiState.update { it.copy(isLoading = false) }
            if (result.isSuccess) {
                val code = result.getOrNull()
                _uiState.update { it.copy(step = ForgotStep.ENTER_CODE, code = code ?: "", success = if (code != null) "Your reset code is ready." else "A reset code has been generated.") }
            } else _uiState.update { it.copy(error = "Failed to send reset code.") }
        }
    }

    fun resetPassword(onSuccess: () -> Unit) {
        val s = _uiState.value
        if (s.code.length != 6) { _uiState.update { it.copy(error = "Enter the 6-digit code") }; return }
        if (s.newPassword.length < 8) { _uiState.update { it.copy(error = "Password must be at least 8 characters") }; return }
        if (s.newPassword != s.confirmPassword) { _uiState.update { it.copy(error = "Passwords do not match") }; return }
        val phone = s.phone.filter { it.isDigit() }
        val fullPhone = "${s.countryCode}$phone"
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            val result = authRepository.resetPassword(fullPhone, s.code.trim(), s.newPassword)
            _uiState.update { it.copy(isLoading = false) }
            if (result.isSuccess) onSuccess() else _uiState.update { it.copy(error = "Invalid or expired code.") }
        }
    }
}

enum class ForgotStep { ENTER_PHONE, ENTER_CODE }
data class ForgotPasswordUiState(
    val step: ForgotStep = ForgotStep.ENTER_PHONE, val phone: String = "", val countryCode: String = "+852",
    val code: String = "", val newPassword: String = "", val confirmPassword: String = "",
    val isLoading: Boolean = false, val error: String? = null, val success: String? = null
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ForgotPasswordScreen(
    initialEmail: String = "", onNavigateBack: () -> Unit, onResetSuccess: () -> Unit,
    viewModel: ForgotPasswordViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    var countryDropdownExpanded by remember { mutableStateOf(false) }
    val selectedCountry = COUNTRY_CODES.find { it.code == uiState.countryCode } ?: COUNTRY_CODES[0]

    Column(
        modifier = Modifier.fillMaxSize().background(White).padding(horizontal = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center
    ) {
        Text("Reset Password", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Indigo700)
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            if (uiState.step == ForgotStep.ENTER_PHONE) "Enter your phone number to receive a reset code."
            else "Enter your code and set a new password.",
            fontSize = 14.sp, color = Gray500, textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(28.dp))

        if (uiState.success != null) {
            Surface(shape = RoundedCornerShape(10.dp), color = Emerald50, modifier = Modifier.fillMaxWidth().padding(bottom = 14.dp)) {
                Text(uiState.success!!, color = Emerald600, fontSize = 13.sp, modifier = Modifier.padding(12.dp))
            }
        }
        if (uiState.error != null) {
            Text(uiState.error!!, color = Rose500, fontSize = 13.sp, modifier = Modifier.padding(bottom = 12.dp))
        }

        when (uiState.step) {
            ForgotStep.ENTER_PHONE -> {
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
                                        viewModel.onCountryCodeChange(cc.code)
                                        countryDropdownExpanded = false
                                    }
                                )
                            }
                        }
                    }

                    Spacer(modifier = Modifier.width(8.dp))

                    OutlinedTextField(
                        value = uiState.phone, onValueChange = viewModel::onPhoneChange,
                        label = { Text("Phone number") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                        modifier = Modifier.weight(1f), singleLine = true, shape = RoundedCornerShape(12.dp)
                    )
                }
                Spacer(modifier = Modifier.height(20.dp))
                Button(onClick = { viewModel.sendCode() }, modifier = Modifier.fillMaxWidth().height(52.dp),
                    enabled = !uiState.isLoading, shape = RoundedCornerShape(12.dp)) {
                    if (uiState.isLoading) CircularProgressIndicator(Modifier.size(22.dp), White, strokeWidth = 2.dp) else Text("Send Reset Code", fontWeight = FontWeight.SemiBold)
                }
            }
            ForgotStep.ENTER_CODE -> {
                OutlinedTextField(value = uiState.code, onValueChange = { if (it.length <= 6) viewModel.onCodeChange(it) }, label = { Text("6-digit code") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth(), singleLine = true, shape = RoundedCornerShape(12.dp))
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(value = uiState.newPassword, onValueChange = viewModel::onNewPasswordChange, label = { Text("New password (min 8 chars)") },
                    visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth(), singleLine = true, shape = RoundedCornerShape(12.dp))
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(value = uiState.confirmPassword, onValueChange = viewModel::onConfirmPasswordChange, label = { Text("Confirm new password") },
                    visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth(), singleLine = true, shape = RoundedCornerShape(12.dp))
                Spacer(modifier = Modifier.height(20.dp))
                Button(onClick = { viewModel.resetPassword(onResetSuccess) }, modifier = Modifier.fillMaxWidth().height(52.dp),
                    enabled = !uiState.isLoading, shape = RoundedCornerShape(12.dp)) {
                    if (uiState.isLoading) CircularProgressIndicator(Modifier.size(22.dp), White, strokeWidth = 2.dp) else Text("Reset Password", fontWeight = FontWeight.SemiBold)
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
        TextButton(onClick = onNavigateBack) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Gray500, modifier = Modifier.size(16.dp))
            Spacer(modifier = Modifier.width(4.dp))
            Text("Back to Sign In", color = Gray500, fontSize = 14.sp)
        }
    }
}
