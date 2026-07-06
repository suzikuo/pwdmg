package com.suzikuo.mypwdmg;

import android.app.Activity;
import android.app.assist.AssistStructure;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.view.autofill.AutofillManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

public class MainActivity extends Activity {
    private AssistStructure autofillStructure;
    private WebView webView;
    private long lastBackPressedAt;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        autofillStructure = getIntent().getParcelableExtra(AutofillManager.EXTRA_ASSIST_STRUCTURE);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

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
        webView.addJavascriptInterface(new AndroidPasswordBridge(this), "androidPasswordApi");

        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    public AssistStructure getAutofillStructure() {
        return autofillStructure;
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
