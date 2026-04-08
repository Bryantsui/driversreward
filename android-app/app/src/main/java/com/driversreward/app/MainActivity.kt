package com.driversreward.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.driversreward.app.data.repository.AuthRepository
import com.driversreward.app.ui.screens.DashboardScreen
import com.driversreward.app.ui.screens.ForgotPasswordScreen
import com.driversreward.app.ui.screens.LoginScreen
import com.driversreward.app.ui.screens.RegisterScreen
import com.driversreward.app.ui.screens.WebViewScreen
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var authRepository: AuthRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    DriversRewardApp(authRepository)
                }
            }
        }
    }
}

@Composable
fun DriversRewardApp(authRepository: AuthRepository) {
    val navController = rememberNavController()
    var startDestination by remember { mutableStateOf<String?>(null) }

    // Check auth state on startup
    LaunchedEffect(Unit) {
        val isLoggedIn = authRepository.isLoggedIn()
        startDestination = if (isLoggedIn) "dashboard" else "login"
    }

    if (startDestination == null) {
        // Still checking auth state
        return
    }

    NavHost(navController = navController, startDestination = startDestination!!) {
        composable("login") {
            LoginScreen(
                onNavigateToRegister = { navController.navigate("register") },
                onNavigateToForgotPassword = { navController.navigate("forgot-password") },
                onLoginSuccess = { 
                    navController.navigate("dashboard") {
                        popUpTo("login") { inclusive = true }
                    }
                }
            )
        }
        composable("forgot-password") {
            ForgotPasswordScreen(
                onNavigateBack = { navController.popBackStack() },
                onResetSuccess = {
                    navController.navigate("login") {
                        popUpTo("forgot-password") { inclusive = true }
                    }
                }
            )
        }
        composable("register") {
            RegisterScreen(
                onNavigateToLogin = { navController.popBackStack() },
                onRegisterSuccess = {
                    navController.navigate("dashboard") {
                        popUpTo("register") { inclusive = true }
                        popUpTo("login") { inclusive = true }
                    }
                }
            )
        }
        composable("dashboard") {
            DashboardScreen(
                onNavigateToUber = { navController.navigate("webview") },
                onLogout = {
                    navController.navigate("login") {
                        popUpTo("dashboard") { inclusive = true }
                    }
                }
            )
        }
        composable("webview") {
            WebViewScreen(onNavigateBack = { navController.popBackStack() })
        }
    }
}
