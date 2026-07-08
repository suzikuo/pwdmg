package com.suzikuo.mypwdmg;

import android.app.Activity;
import android.app.assist.AssistStructure;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.view.autofill.AutofillManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

public class MainActivity extends Activity {
    private static final String TAG = "PwdMainActivity";
    public static final String EXTRA_AUTOFILL_PICKER = "com.suzikuo.mypwdmg.extra.AUTOFILL_PICKER";
    private AssistStructure autofillStructure;
    private WebView webView;
    private long lastBackPressedAt;
    private String systemBarsTheme = "light";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        autofillStructure = getIntent().getParcelableExtra(AutofillManager.EXTRA_ASSIST_STRUCTURE);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        applySystemBarsTheme(systemBarsTheme);

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            webView.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_YES);
        }

        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                Log.e(
                    TAG,
                    "WebView console: " + consoleMessage.message()
                        + " (" + consoleMessage.sourceId() + ":" + consoleMessage.lineNumber() + ")"
                );
                return super.onConsoleMessage(consoleMessage);
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                Log.d(TAG, "WebView page loaded: " + url);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    Log.e(TAG, "WebView load error: " + error.getDescription() + " url=" + request.getUrl());
                }
            }
        });
        webView.addJavascriptInterface(new AndroidPasswordBridge(this), "androidPasswordApi");

        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html?v=" + BuildConfig.VERSION_NAME + "-" + BuildConfig.VERSION_CODE);
    }

    public AssistStructure getAutofillStructure() {
        return autofillStructure;
    }

    public void applySystemBarsTheme(String theme) {
        String normalized = theme == null ? "light" : theme.trim().toLowerCase();
        boolean dark = "dark".equals(normalized);
        systemBarsTheme = dark ? "dark" : "light";
        int barColor = Color.parseColor(dark ? "#111827" : "#eef3f0");
        getWindow().setStatusBarColor(barColor);
        getWindow().setNavigationBarColor(barColor);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            int flags = getWindow().getDecorView().getSystemUiVisibility();
            if (dark) {
                flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            } else {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            getWindow().getDecorView().setSystemUiVisibility(flags);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            int flags = getWindow().getDecorView().getSystemUiVisibility();
            if (dark) flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            else flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            getWindow().getDecorView().setSystemUiVisibility(flags);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            handleBackFallback();
            return;
        }

        webView.evaluateJavascript(
            "(function(){return !!(window.__mypwdmgHandleNativeBack && window.__mypwdmgHandleNativeBack());})()",
            value -> {
                if (!"true".equals(value)) {
                    handleBackFallback();
                }
            }
        );
    }

    private void handleBackFallback() {
        long now = System.currentTimeMillis();
        if (now - lastBackPressedAt < 1600) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                finishAndRemoveTask();
            } else {
                finish();
            }
            return;
        }

        lastBackPressedAt = now;
        Toast.makeText(this, "再按一次退出", Toast.LENGTH_SHORT).show();
    }
}
