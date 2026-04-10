package com.driversreward.app.ui.screens

import android.annotation.SuppressLint
import android.app.Dialog
import android.graphics.Bitmap
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.webkit.*
import com.driversreward.app.BuildConfig
import com.driversreward.app.R
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.findViewTreeSavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import com.driversreward.app.ui.theme.*
import kotlinx.coroutines.delay
import java.io.InputStreamReader

private const val TAG = "DriversReward"

@OptIn(ExperimentalMaterial3Api::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebViewScreen(
    onNavigateBack: () -> Unit,
    viewModel: WebViewViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    val interceptorScript = remember {
        try {
            context.assets.open("interceptor-main.js").use { stream ->
                InputStreamReader(stream).readText()
            }
        } catch (_: Exception) { "" }
    }

    val earlyHook = remember {
        """
        (function(){
            if(window.__drEarlyHook) return;
            window.__drEarlyHook=true;
            var of=window.fetch;
            window.fetch=function(){
                var a=arguments,u=typeof a[0]==='string'?a[0]:(a[0]&&a[0].url||''),h={};
                if(a[1]&&a[1].headers){
                    var src=a[1].headers;
                    if(src instanceof Headers){src.forEach(function(v,k){h[k.toLowerCase()]=v;});}
                    else if(typeof src==='object'){for(var k in src){h[k.toLowerCase()]=src[k];}}
                }
                if(h['x-csrf-token']&&!window.__drCapturedHeaders&&u.includes('/earnings/api/')){
                    window.__drCapturedHeaders=h;
                }
                return of.apply(this,arguments);
            };
            var oo=XMLHttpRequest.prototype.open,os=XMLHttpRequest.prototype.send,oh=XMLHttpRequest.prototype.setRequestHeader;
            XMLHttpRequest.prototype.open=function(m,u){this._drUrl=u;this._drH={};return oo.apply(this,arguments);};
            XMLHttpRequest.prototype.setRequestHeader=function(k,v){if(this._drH)this._drH[k.toLowerCase()]=v;return oh.apply(this,arguments);};
            XMLHttpRequest.prototype.send=function(){
                if(this._drH&&this._drH['x-csrf-token']&&!window.__drCapturedHeaders&&this._drUrl&&this._drUrl.includes('/earnings/api/')){
                    window.__drCapturedHeaders=this._drH;
                }
                return os.apply(this,arguments);
            };
        })();
        """.trimIndent()
    }

    val isComplete = uiState.syncStep == "complete"
    var showOverlay by remember { mutableStateOf(false) }
    var captchaInterrupted by remember { mutableStateOf(false) }
    val webViewRef = remember { mutableStateOf<WebView?>(null) }

    // Reset ViewModel state each time the screen is entered
    LaunchedEffect(Unit) {
        viewModel.resetState()
    }

    // Show overlay as soon as we detect login (before auto-fetch starts)
    LaunchedEffect(uiState.loginState) {
        if (uiState.loginState == "logged_in" && !showOverlay && !captchaInterrupted) {
            Log.d(TAG, "Login detected — showing overlay immediately")
            showOverlay = true
            captchaInterrupted = false
        }
    }

    LaunchedEffect(uiState.syncStep) {
        if (uiState.syncStep != null && uiState.syncStep != "complete" && !showOverlay && !captchaInterrupted) {
            showOverlay = true
        }
    }

    // Stuck detection: if overlay is shown but no progress change for 30s, dismiss
    LaunchedEffect(showOverlay, uiState.syncStep, uiState.syncProgress) {
        if (showOverlay && uiState.syncStep != "complete") {
            val snapshotStep = uiState.syncStep
            val snapshotProg = uiState.syncProgress
            delay(30_000)
            if (showOverlay && uiState.syncStep == snapshotStep && uiState.syncProgress == snapshotProg
                && uiState.syncStep != "complete") {
                Log.w(TAG, "Sync appears stuck (no progress for 30s) — dismissing overlay")
                showOverlay = false
            }
        }
    }

    // On completion: navigate back to home (dialog cleaned up by DisposableEffect)
    LaunchedEffect(isComplete) {
        if (isComplete) {
            delay(2500)
            onNavigateBack()
        }
    }

    // Captcha/challenge detection: if URL changes to auth page while syncing, pause overlay
    fun onUrlChanged(url: String) {
        val isChallenge = url.contains("/challenge") || url.contains("/auth/") ||
                url.contains("/login") || url.contains("auth.uber.com")
        if (isChallenge && showOverlay) {
            Log.w(TAG, "Challenge/captcha detected during sync — pausing overlay")
            showOverlay = false
            captchaInterrupted = true
            webViewRef.value?.visibility = android.view.View.VISIBLE
        }
    }

    // Cancel handler: user explicitly stops sync
    val onCancelSync: () -> Unit = {
        Log.d(TAG, "User cancelled sync")
        showOverlay = false
        onNavigateBack()
    }

    // Native Android Dialog overlay
    val dialogRef = remember { mutableStateOf<Dialog?>(null) }

    DisposableEffect(Unit) {
        onDispose {
            dialogRef.value?.dismiss()
            webViewRef.value?.apply {
                stopLoading()
                destroy()
            }
            webViewRef.value = null
        }
    }

    LaunchedEffect(showOverlay) {
        Log.d(TAG, "LaunchedEffect showOverlay=$showOverlay")
        if (showOverlay && dialogRef.value == null) {
            val activity = context as? android.app.Activity ?: return@LaunchedEffect
            val dialog = Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
            dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
            dialog.setCancelable(false)

            val composeView = ComposeView(activity).apply {
                setViewTreeLifecycleOwner(lifecycleOwner)
                activity.window?.decorView?.let { rootView ->
                    rootView.findViewTreeSavedStateRegistryOwner()?.let {
                        setViewTreeSavedStateRegistryOwner(it)
                    }
                }
            }

            dialog.setContentView(composeView)
            dialog.window?.apply {
                setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                setBackgroundDrawableResource(android.R.color.transparent)
                addFlags(WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS)
            }

            composeView.setContent {
                val currentState by viewModel.uiState.collectAsState()
                SyncOverlayContent(uiState = currentState, onCancel = onCancelSync)
            }

            dialog.show()
            dialogRef.value = dialog
            Log.d(TAG, "Dialog shown!")
        } else if (!showOverlay && dialogRef.value != null) {
            dialogRef.value?.dismiss()
            dialogRef.value = null
            Log.d(TAG, "Dialog dismissed!")
        }
    }

    Column(modifier = Modifier.fillMaxSize().background(Gray50)) {
        TopAppBar(
            title = { Text("Uber Driver Portal", fontWeight = FontWeight.SemiBold) },
            navigationIcon = {
                IconButton(onClick = onNavigateBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = White,
                titleContentColor = Gray900,
                navigationIconContentColor = Indigo600
            )
        )

        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                val cookieManager = CookieManager.getInstance()
                cookieManager.setAcceptCookie(true)
                if (BuildConfig.DEBUG) {
                    WebView.setWebContentsDebuggingEnabled(true)
                }

                WebView(ctx).apply {
                    webViewRef.value = this
                    visibility = android.view.View.INVISIBLE
                    cookieManager.setAcceptThirdPartyCookies(this, true)

                    settings.apply {
                        javaScriptEnabled = true
                        domStorageEnabled = true
                        @Suppress("DEPRECATION")
                        databaseEnabled = true
                        cacheMode = WebSettings.LOAD_DEFAULT
                        setSupportMultipleWindows(false)
                        loadWithOverviewMode = true
                        useWideViewPort = true
                        mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                        userAgentString = userAgentString
                            .replace("; wv)", ")")
                            .replace("Version/\\S+\\s*".toRegex(), "")
                    }

                    addJavascriptInterface(PostMessageBridge(viewModel), "DriversRewardBridge")

                    webChromeClient = object : WebChromeClient() {
                        override fun onConsoleMessage(msg: ConsoleMessage?): Boolean {
                            msg?.let { Log.d(TAG, "JS [${it.sourceId()}:${it.lineNumber()}] ${it.message()}") }
                            return true
                        }
                    }

                    webViewClient = object : WebViewClient() {
                        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                            super.onPageStarted(view, url, favicon)
                            if (url != null) onUrlChanged(url)
                            if (url?.contains("drivers.uber.com") == true) {
                                view?.evaluateJavascript(earlyHook, null)
                            }
                        }

                        override fun onPageFinished(view: WebView?, url: String?) {
                            super.onPageFinished(view, url)
                            cookieManager.flush()

                            val isAuthPage = url?.contains("/auth/") == true ||
                                    url?.contains("/login") == true ||
                                    url?.contains("/challenge") == true ||
                                    url?.contains("auth.uber.com") == true
                            if (isAuthPage) {
                                view?.visibility = android.view.View.VISIBLE
                            }

                            if (url?.contains("drivers.uber.com") == true && !isAuthPage) {
                                view?.evaluateJavascript(POSTMESSAGE_ADAPTER, null)
                                view?.evaluateJavascript(interceptorScript, null)
                            }
                        }

                        override fun shouldOverrideUrlLoading(
                            view: WebView?, request: WebResourceRequest?
                        ): Boolean {
                            val host = request?.url?.host ?: return true
                            val allowed = host.endsWith("uber.com") || host.endsWith("uber.org")
                            if (!allowed) {
                                Log.w(TAG, "Blocked navigation to untrusted host: $host")
                            }
                            return !allowed
                        }
                    }

                    loadUrl("https://drivers.uber.com/")
                }
            }
        )
    }
}


@Composable
fun SyncOverlayContent(
    uiState: WebViewUiState,
    onCancel: () -> Unit = {}
) {
    val step = uiState.syncStep
    val isComplete = step == "complete"
    var showCancelConfirm by remember { mutableStateOf(false) }

    val currentStepIndex = when (step) {
        "starting", "fetching_history" -> 1
        "fetching_details" -> 2
        "submitting" -> 3
        "complete" -> 4
        else -> if (uiState.isSyncing) 1 else 0
    }

    val progressFraction = when {
        step == "fetching_history" && uiState.syncTotal > 0 ->
            uiState.syncProgress.toFloat() / uiState.syncTotal
        step == "fetching_details" && uiState.syncTotal > 0 ->
            uiState.syncProgress.toFloat() / uiState.syncTotal
        step == "submitting" -> 0.85f
        step == "complete" -> 1f
        uiState.isSyncing -> 0.1f
        else -> 0f
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    colors = if (isComplete)
                        listOf(Emerald500, Emerald600)
                    else
                        listOf(Color(0xFF312E81), Indigo700)
                )
            ),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 32.dp)
        ) {
            Box(
                modifier = Modifier.size(120.dp),
                contentAlignment = Alignment.Center
            ) {
                if (isComplete) {
                    CompletionAnimation()
                } else {
                    ScanningAnimation(step = step, progress = progressFraction)
                }
            }

            Spacer(modifier = Modifier.height(28.dp))

            val headline = when (step) {
                "starting", "fetching_history" -> "Scanning Trip History"
                "fetching_details" -> "Calculating Rewards"
                "submitting" -> "Finalizing Point Balance"
                "complete" -> "Points Updated!"
                else -> if (uiState.isSyncing) "Scanning Trip History" else "Getting Ready..."
            }

            Text(headline, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = White, textAlign = TextAlign.Center)

            Spacer(modifier = Modifier.height(8.dp))

            val subtitle = when {
                step == "fetching_history" -> "Reviewing your recent trips..."
                step == "fetching_details" -> "Processing ${uiState.syncProgress} of ${uiState.syncTotal} trips"
                step == "submitting" -> "Almost there..."
                step == "complete" -> "Your reward points are up to date"
                step == "starting" -> "Connecting to your account..."
                uiState.isSyncing -> "Collecting your trip data..."
                else -> "Connecting to Uber..."
            }

            Text(subtitle, fontSize = 14.sp, color = White.copy(alpha = 0.8f), textAlign = TextAlign.Center)

            if (!isComplete) {
                Spacer(modifier = Modifier.height(32.dp))
                StepTimeline(currentStep = currentStepIndex)
                Spacer(modifier = Modifier.height(24.dp))

                if (progressFraction > 0f) {
                    val animatedProgress by animateFloatAsState(
                        targetValue = progressFraction,
                        animationSpec = tween(400, easing = CubicBezierEasing(0.33f, 1f, 0.68f, 1f)),
                        label = "progress"
                    )
                    Box(
                        modifier = Modifier.fillMaxWidth().height(6.dp)
                            .clip(RoundedCornerShape(3.dp))
                            .background(White.copy(alpha = 0.2f))
                    ) {
                        Box(
                            modifier = Modifier.fillMaxHeight()
                                .fillMaxWidth(animatedProgress)
                                .clip(RoundedCornerShape(3.dp))
                                .background(Brush.horizontalGradient(listOf(White.copy(alpha = 0.7f), White)))
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("${(progressFraction * 100).toInt()}%", fontSize = 12.sp, color = White.copy(alpha = 0.6f), fontWeight = FontWeight.Medium)
                }

                Spacer(modifier = Modifier.height(24.dp))

                if (!showCancelConfirm) {
                    TextButton(onClick = { showCancelConfirm = true }) {
                        Text("Cancel", fontSize = 13.sp, color = White.copy(alpha = 0.5f))
                    }
                } else {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = White.copy(alpha = 0.15f)),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Text(
                                "Interrupting may result in incomplete point calculation. Are you sure?",
                                fontSize = 13.sp, color = White.copy(alpha = 0.9f),
                                textAlign = TextAlign.Center, lineHeight = 18.sp
                            )
                            Spacer(modifier = Modifier.height(12.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                OutlinedButton(
                                    onClick = { showCancelConfirm = false },
                                    colors = ButtonDefaults.outlinedButtonColors(contentColor = White),
                                    shape = RoundedCornerShape(8.dp),
                                    modifier = Modifier.weight(1f)
                                ) { Text("Continue", fontSize = 13.sp) }
                                Button(
                                    onClick = onCancel,
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = Color(0xFFEF4444),
                                        contentColor = White
                                    ),
                                    shape = RoundedCornerShape(8.dp),
                                    modifier = Modifier.weight(1f)
                                ) { Text("Stop", fontSize = 13.sp) }
                            }
                        }
                    }
                }
            } else {
                Spacer(modifier = Modifier.height(20.dp))
                Text("Returning to home...",
                    fontSize = 12.sp, color = White.copy(alpha = 0.6f), textAlign = TextAlign.Center, lineHeight = 18.sp)
            }
        }
    }
}


@Composable
fun ScanningAnimation(step: String?, progress: Float) {
    val inf = rememberInfiniteTransition(label = "scan")
    val rotation by inf.animateFloat(0f, 360f, infiniteRepeatable(tween(2000, easing = LinearEasing)), label = "rot")
    val pulse by inf.animateFloat(0.85f, 1.05f, infiniteRepeatable(tween(1200, easing = CubicBezierEasing(0.65f, 0f, 0.35f, 1f)), RepeatMode.Reverse), label = "pulse")

    Box(Modifier.size(120.dp).scale(pulse), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(120.dp).rotate(rotation)) {
            drawArc(Color.White.copy(alpha = 0.3f), 0f, 270f, false, style = Stroke(3.dp.toPx(), cap = StrokeCap.Round))
        }
        Canvas(Modifier.size(100.dp).rotate(-rotation * 0.7f)) {
            drawArc(Color.White.copy(alpha = 0.2f), 45f, 180f, false, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round))
        }
        Box(Modifier.size(72.dp).clip(CircleShape).background(White.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
            val emoji = when (step) {
                "starting", "fetching_history" -> "\uD83D\uDD0D"
                "fetching_details" -> "\uD83D\uDCB0"
                "submitting" -> "\u2601\uFE0F"
                else -> "\uD83D\uDD0D"
            }
            Text(emoji, fontSize = 36.sp)
        }
    }
}


@Composable
fun CompletionAnimation() {
    val scale = remember { Animatable(0f) }
    val alpha = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        scale.animateTo(1f, spring(0.5f, 300f))
        alpha.animateTo(1f, tween(400))
    }
    Box(Modifier.size(120.dp).scale(scale.value), contentAlignment = Alignment.Center) {
        Box(Modifier.size(100.dp).clip(CircleShape).background(White.copy(alpha = 0.2f)), contentAlignment = Alignment.Center) {
            Box(Modifier.size(72.dp).clip(CircleShape).background(White.copy(alpha = 0.25f)), contentAlignment = Alignment.Center) {
                Text("\uD83C\uDF89", fontSize = 40.sp, modifier = Modifier.alpha(alpha.value))
            }
        }
    }
}


@Composable
fun StepTimeline(currentStep: Int) {
    val steps = listOf("Scanning Trips", "Calculating Rewards", "Finalizing Balance")
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        steps.forEachIndexed { i, label ->
            val n = i + 1
            val st = when { n < currentStep -> "done"; n == currentStep -> "active"; else -> "pending" }
            StepDot(label, st)
            if (i < steps.lastIndex) {
                Box(Modifier.width(24.dp).height(2.dp)
                    .background(if (n < currentStep) White.copy(alpha = 0.6f) else White.copy(alpha = 0.15f)))
            }
        }
    }
}


@Composable
fun StepDot(label: String, state: String) {
    val inf = rememberInfiniteTransition(label = "dot")
    val pulse by inf.animateFloat(1f, 1.15f, infiniteRepeatable(tween(800, easing = CubicBezierEasing(0.65f, 0f, 0.35f, 1f)), RepeatMode.Reverse), label = "dp")

    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(80.dp)) {
        Box(
            Modifier.size(if (state == "active") 32.dp else 26.dp)
                .scale(if (state == "active") pulse else 1f)
                .clip(CircleShape)
                .background(when (state) { "done" -> White.copy(0.9f); "active" -> White; else -> White.copy(0.15f) }),
            contentAlignment = Alignment.Center
        ) {
            when (state) {
                "done" -> Icon(Icons.Default.Check, null, tint = Emerald500, modifier = Modifier.size(16.dp))
                "active" -> {
                    val spin by inf.animateFloat(0f, 360f, infiniteRepeatable(tween(1000, easing = LinearEasing)), label = "sp")
                    Text("\u21BB", fontSize = 14.sp, color = Indigo600, fontWeight = FontWeight.Bold, modifier = Modifier.rotate(spin))
                }
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(label, fontSize = 10.sp, textAlign = TextAlign.Center, lineHeight = 13.sp,
            color = when (state) { "done" -> White.copy(0.8f); "active" -> White; else -> White.copy(0.35f) },
            fontWeight = if (state == "active") FontWeight.SemiBold else FontWeight.Normal)
    }
}


private class PostMessageBridge(private val viewModel: WebViewViewModel) {
    @JavascriptInterface
    fun onMessage(messageJson: String) {
        try {
            if (BuildConfig.DEBUG) Log.d(TAG, "Bridge received: ${messageJson.take(200)}")
            val json = org.json.JSONObject(messageJson)
            val type = json.optString("type", "")
            val body = json.optString("body", "")
            val url = json.optString("url", "")

            when (type) {
                "UBER_TRIP_CAPTURED" -> viewModel.onTripCaptured(body, url)
                "UBER_ACTIVITY_FEED_CAPTURED" -> viewModel.onActivityFeedCaptured(body)
                "UBER_BONUSES_CAPTURED" -> viewModel.onBonusesCaptured(body)
                "AUTO_FETCH_COMPLETE" -> {
                    viewModel.onProgressUpdate("complete", "All done!", 0, 0)
                    viewModel.onAutoFetchComplete()
                }
                "UBER_CSRF_CAPTURED" -> {
                    val bodyObj = org.json.JSONObject(body)
                    viewModel.onCsrfCaptured(bodyObj.optString("csrfToken", ""))
                }
                "UBER_LOGIN_STATE" -> {
                    val bodyObj = org.json.JSONObject(body)
                    viewModel.onLoginState(
                        bodyObj.optString("state", "unknown"),
                        bodyObj.optString("message", "")
                    )
                }
                "PROGRESS_UPDATE" -> {
                    val bodyObj = org.json.JSONObject(body)
                    val step = bodyObj.optString("step", "")
                    val message = bodyObj.optString("message", "")
                    val fetched = bodyObj.optInt("fetched", bodyObj.optInt("week", 0))
                    val total = bodyObj.optInt("total", bodyObj.optInt("totalWeeks", 0))
                    viewModel.onProgressUpdate(step, message, fetched, total)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Bridge error: ${e.message}")
        }
    }
}

private const val POSTMESSAGE_ADAPTER = """
(function() {
    if (window.__drPostMessageAdapter) return;
    window.__drPostMessageAdapter = true;
    window.addEventListener('message', function(event) {
        if (event.data && event.data.source === 'driversreward-interceptor') {
            try {
                DriversRewardBridge.onMessage(JSON.stringify(event.data));
            } catch(e) {
                console.error('[DriversReward] Bridge call failed:', e);
            }
        }
    });
    console.log('[DriversReward] PostMessage adapter installed');
})();
"""
