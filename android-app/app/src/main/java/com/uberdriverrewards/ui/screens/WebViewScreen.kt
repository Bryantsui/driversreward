package com.uberdriverrewards.ui.screens

import android.annotation.SuppressLint
import android.webkit.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import kotlinx.serialization.json.Json

/**
 * WebView screen that loads the Uber driver portal and intercepts API responses
 * containing trip and activity feed data.
 *
 * Session persistence strategy:
 * - CookieManager set to accept and persist all cookies (survives app restart)
 * - WebView database/DOM storage enabled for localStorage/sessionStorage
 * - Cache mode set to LOAD_DEFAULT (uses cache when available, reduces requests)
 * - Mixed content allowed (some Uber resources may use HTTP)
 * - Third-party cookies accepted (required for Uber SSO flow)
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebViewScreen(
    viewModel: WebViewViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    Column(modifier = Modifier.fillMaxSize()) {
        if (uiState.pointsEarned > 0) {
            Snackbar(
                modifier = Modifier.padding(horizontal = 16.dp),
            ) {
                Text("Earned ${uiState.pointsEarned} points from ${uiState.tripsProcessed} trips!")
            }
        }

        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                // Ensure CookieManager persists cookies across sessions
                val cookieManager = CookieManager.getInstance()
                cookieManager.setAcceptCookie(true)

                WebView(ctx).apply {
                    // Accept third-party cookies (needed for Uber SSO)
                    cookieManager.setAcceptThirdPartyCookies(this, true)

                    settings.apply {
                        javaScriptEnabled = true
                        domStorageEnabled = true
                        databaseEnabled = true

                        // Cache settings for session persistence
                        cacheMode = WebSettings.LOAD_DEFAULT
                        setSupportMultipleWindows(false)
                        loadWithOverviewMode = true
                        useWideViewPort = true

                        // Allow mixed content (some Uber resources)
                        mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE

                        // User agent: appear as normal Chrome so Uber doesn't block
                        userAgentString = userAgentString.replace(
                            Regex("wv|Version/\\S+"),
                            ""
                        ) + " DriversBonus/1.0"
                    }

                    addJavascriptInterface(
                        UberDataBridge(viewModel),
                        "DriversBonusBridge"
                    )

                    webViewClient = object : WebViewClient() {
                        override fun onPageFinished(view: WebView?, url: String?) {
                            super.onPageFinished(view, url)

                            // Flush cookies to disk after every page load
                            cookieManager.flush()

                            // Inject fetch/XHR interceptor
                            view?.evaluateJavascript(INTERCEPTOR_SCRIPT, null)
                        }

                        override fun shouldOverrideUrlLoading(
                            view: WebView?,
                            request: WebResourceRequest?
                        ): Boolean {
                            val host = request?.url?.host ?: return false
                            // Keep Uber-related navigation inside the WebView
                            return !host.contains("uber.com")
                        }
                    }

                    // Load existing cookies if driver was previously logged in
                    loadUrl("https://drivers.uber.com/earnings")
                }
            }
        )
    }
}

private class UberDataBridge(private val viewModel: WebViewViewModel) {
    @JavascriptInterface
    fun onTripCaptured(rawJson: String) {
        viewModel.onTripCaptured(rawJson)
    }

    @JavascriptInterface
    fun onActivityFeedCaptured(rawJson: String) {
        viewModel.onActivityFeedCaptured(rawJson)
    }
}

private const val INTERCEPTOR_SCRIPT = """
(function() {
  if (window.__udrInterceptorInstalled) return;
  window.__udrInterceptorInstalled = true;

  const TRIP_URL = '/earnings/api/getTrip';
  const FEED_URL = '/earnings/api/getWebActivityFeed';
  const origFetch = window.fetch;

  window.fetch = async function(...args) {
    const response = await origFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');

    if (url.includes(TRIP_URL)) {
      response.clone().text().then(function(body) {
        try { DriversBonusBridge.onTripCaptured(body); } catch(e) {}
      });
    } else if (url.includes(FEED_URL)) {
      response.clone().text().then(function(body) {
        try { DriversBonusBridge.onActivityFeedCaptured(body); } catch(e) {}
      });
    }

    return response;
  };

  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._udrUrl = url;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    this.addEventListener('load', function() {
      var url = this._udrUrl || '';
      if (url.includes(TRIP_URL)) {
        try { DriversBonusBridge.onTripCaptured(this.responseText); } catch(e) {}
      } else if (url.includes(FEED_URL)) {
        try { DriversBonusBridge.onActivityFeedCaptured(this.responseText); } catch(e) {}
      }
    });
    return origSend.apply(this, arguments);
  };
})();
"""
