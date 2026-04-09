package com.driversreward.app.ui.screens

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.util.Log
import android.webkit.*
import com.driversreward.app.BuildConfig
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.zIndex
import androidx.hilt.navigation.compose.hiltViewModel
import com.driversreward.app.ui.theme.*
import com.google.gson.Gson
import kotlinx.coroutines.delay
import java.io.InputStreamReader

private const val TAG = "DriversReward"

private data class InterceptorMessage(
    val source: String? = null,
    val type: String = "",
    val body: String = "",
    val url: String? = null
)

@OptIn(ExperimentalMaterial3Api::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebViewScreen(
    onNavigateBack: () -> Unit,
    viewModel: WebViewViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current

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

    var isStatusExpanded by remember { mutableStateOf(true) }
    val isComplete = uiState.syncStep == "complete"

    LaunchedEffect(isComplete) {
        if (isComplete) {
            delay(5000)
            isStatusExpanded = false
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

        Box(modifier = Modifier.weight(1f)) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    val cookieManager = CookieManager.getInstance()
                    cookieManager.setAcceptCookie(true)
                    if (BuildConfig.DEBUG) {
                        WebView.setWebContentsDebuggingEnabled(true)
                    }

                    WebView(ctx).apply {
                        cookieManager.setAcceptThirdPartyCookies(this, true)

                        settings.apply {
                            javaScriptEnabled = true
                            domStorageEnabled = true
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
                                if (url?.contains("drivers.uber.com") == true) {
                                    view?.evaluateJavascript(earlyHook, null)
                                }
                            }

                            override fun onPageFinished(view: WebView?, url: String?) {
                                super.onPageFinished(view, url)
                                cookieManager.flush()
                                if (url?.contains("drivers.uber.com") == true &&
                                    !url.contains("/auth/") && !url.contains("/login")) {
                                    view?.evaluateJavascript(interceptorScript, null)
                                    view?.evaluateJavascript(POSTMESSAGE_ADAPTER, null)
                                }
                            }

                            override fun shouldOverrideUrlLoading(
                                view: WebView?, request: WebResourceRequest?
                            ): Boolean = false
                        }

                        loadUrl("https://drivers.uber.com/")
                    }
                }
            )

            FloatingStatusCard(
                uiState = uiState,
                isExpanded = isStatusExpanded,
                onToggle = { isStatusExpanded = !isStatusExpanded },
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .zIndex(10f)
                    .padding(horizontal = 10.dp, vertical = 6.dp)
            )
        }
    }
}

@Composable
fun FloatingStatusCard(
    uiState: WebViewUiState,
    isExpanded: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier
) {
    val step = uiState.syncStep
    val login = uiState.loginState

    val s1 = when {
        login == "logged_in" || step != null -> "done"
        login == "checking" -> "active"
        else -> ""
    }
    val s2 = when {
        step == "starting" || step == "fetching_history" -> "active"
        step == "fetching_details" || step == "submitting" || step == "complete" -> "done"
        else -> ""
    }
    val s3 = when {
        step == "fetching_details" -> "active"
        step == "submitting" || step == "complete" -> "done"
        else -> ""
    }
    val s4 = when {
        step == "submitting" -> "active"
        step == "complete" -> "done"
        else -> ""
    }

    val progressPct = when {
        step == "fetching_history" && uiState.syncTotal > 0 -> uiState.syncProgress.toFloat() / uiState.syncTotal
        step == "fetching_details" && uiState.syncTotal > 0 -> uiState.syncProgress.toFloat() / uiState.syncTotal
        step == "submitting" -> 0.9f
        step == "complete" -> 1f
        else -> 0f
    }

    val detailText = when {
        login == "logged_out" || login == "unknown" -> "Log in to Uber below to begin."
        login == "checking" && step == null -> "Verifying your Uber session..."
        step == "starting" || step == "fetching_history" -> uiState.syncMessage ?: "Scanning trip history..."
        step == "fetching_details" -> uiState.syncMessage ?: "Fetching trip details..."
        step == "submitting" -> uiState.syncMessage ?: "Sending data to server..."
        step == "complete" -> "All done! Your points have been updated."
        login == "logged_in" && step == null -> "Uber session verified. Preparing data collection..."
        else -> ""
    }

    val showBar = step != null || login == "checking"
    val isActive = step != null && step != "complete"

    val headerBg = when {
        step == "complete" -> Emerald500
        isActive -> Indigo600
        login == "logged_in" -> Indigo600
        else -> Gray600
    }
    val summaryText = when {
        step == "complete" -> "Sync complete!"
        step == "fetching_details" -> "Fetching ${uiState.syncProgress}/${uiState.syncTotal} trips..."
        step == "fetching_history" -> "Scanning week ${uiState.syncProgress}/${uiState.syncTotal}..."
        step == "submitting" -> "Sending to server..."
        step == "starting" -> "Starting..."
        login == "logged_in" -> "Preparing data collection..."
        login == "checking" -> "Checking session..."
        else -> "Waiting for login..."
    }

    Card(
        modifier = modifier
            .fillMaxWidth()
            .shadow(8.dp, RoundedCornerShape(14.dp)),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = White)
    ) {
        Column {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(headerBg)
                    .clickable(onClick = onToggle)
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                SessionDot(login)
                Spacer(modifier = Modifier.width(10.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        "Data Collection",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = White
                    )
                    if (!isExpanded) {
                        Text(summaryText, fontSize = 11.sp, color = White.copy(alpha = 0.8f))
                    }
                }
                Icon(
                    if (isExpanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                    contentDescription = "Toggle",
                    tint = White,
                    modifier = Modifier.size(20.dp)
                )
            }

            AnimatedVisibility(visible = isExpanded) {
                Column(modifier = Modifier.padding(14.dp)) {
                    StepRow(1, "Log in to Uber Driver Portal", s1)
                    StepRow(2, "Scan trip history", s2)
                    StepRow(3, "Fetch trip details", s3)
                    StepRow(4, "Sync to server & earn points", s4)

                    if (showBar) {
                        Spacer(modifier = Modifier.height(10.dp))
                        LinearProgressIndicator(
                            progress = { if (progressPct > 0f) progressPct else 0f },
                            modifier = Modifier.fillMaxWidth().height(5.dp).clip(RoundedCornerShape(3.dp)),
                            color = Indigo600,
                            trackColor = Gray200,
                        )
                    }

                    if (detailText.isNotEmpty()) {
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(detailText, fontSize = 11.sp, color = Gray400)
                    }

                    if (step == "complete") {
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            "Recent trips may take a few hours to appear in Uber\u2019s system.",
                            fontSize = 10.sp,
                            color = Gray400
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun StepRow(number: Int, label: String, state: String) {
    val dotColor = when (state) {
        "done" -> Emerald500
        "active" -> Indigo600
        "error" -> Rose500
        else -> Gray200
    }
    val textColor = when (state) {
        "active" -> Gray900
        "done" -> Emerald500
        "error" -> Rose500
        else -> Gray400
    }
    val fontWeight = if (state == "active") FontWeight.Medium else FontWeight.Normal
    val icon = when (state) {
        "done" -> "\u2713"
        "error" -> "\u2717"
        else -> "$number"
    }

    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 3.dp)) {
        Box(
            modifier = Modifier.size(20.dp).clip(CircleShape).background(dotColor),
            contentAlignment = Alignment.Center
        ) {
            if (state == "active") {
                val infiniteTransition = rememberInfiniteTransition(label = "spin")
                @Suppress("UNUSED_VARIABLE")
                val angle by infiniteTransition.animateFloat(
                    initialValue = 0f, targetValue = 360f,
                    animationSpec = infiniteRepeatable(tween(600, easing = LinearEasing)),
                    label = "spin"
                )
                Text("\u21BB", fontSize = 10.sp, color = White)
            } else {
                Text(icon, fontSize = 10.sp, color = if (state.isEmpty()) Gray400 else White, fontWeight = FontWeight.Bold)
            }
        }
        Spacer(modifier = Modifier.width(10.dp))
        Text(label, fontSize = 12.sp, color = textColor, fontWeight = fontWeight)
    }
}

@Composable
fun SessionDot(login: String) {
    val dotColor = when (login) {
        "logged_in" -> Emerald500
        "checking" -> Sky500
        "logged_out" -> Amber500
        else -> Gray400
    }
    val text = when (login) {
        "logged_in" -> "Uber session active"
        "checking" -> "Checking Uber session..."
        "logged_out" -> "Not logged in to Uber"
        else -> "Waiting for Uber portal..."
    }

    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val alpha by infiniteTransition.animateFloat(
        initialValue = 1f, targetValue = 0.4f,
        animationSpec = infiniteRepeatable(tween(750, easing = LinearEasing), repeatMode = RepeatMode.Reverse),
        label = "pulse"
    )
    val actualAlpha = if (login == "checking") alpha else 1f

    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(modifier = Modifier.size(8.dp).clip(CircleShape).background(dotColor.copy(alpha = actualAlpha)))
        Spacer(modifier = Modifier.width(8.dp))
        Text(text, fontSize = 12.sp, color = Gray400)
    }
}

private class PostMessageBridge(private val viewModel: WebViewViewModel) {
    private val gson = Gson()

    @JavascriptInterface
    fun onMessage(messageJson: String) {
        try {
            Log.d(TAG, "Bridge: ${messageJson.take(200)}")
            val msg = gson.fromJson(messageJson, InterceptorMessage::class.java)
            when (msg.type) {
                "UBER_TRIP_CAPTURED" -> viewModel.onTripCaptured(msg.body, msg.url ?: "")
                "UBER_ACTIVITY_FEED_CAPTURED" -> viewModel.onActivityFeedCaptured(msg.body)
                "AUTO_FETCH_COMPLETE" -> {
                    viewModel.onProgressUpdate("complete", "All done!", 0, 0)
                    viewModel.onAutoFetchComplete()
                }
                "UBER_CSRF_CAPTURED" -> {
                    val bodyObj = org.json.JSONObject(msg.body)
                    viewModel.onCsrfCaptured(bodyObj.optString("csrfToken", ""))
                }
                "UBER_LOGIN_STATE" -> {
                    val bodyObj = org.json.JSONObject(msg.body)
                    viewModel.onLoginState(
                        bodyObj.optString("state", "unknown"),
                        bodyObj.optString("message", "")
                    )
                }
                "PROGRESS_UPDATE" -> {
                    val bodyObj = org.json.JSONObject(msg.body)
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
            } catch(e) {}
        }
    });
})();
"""
