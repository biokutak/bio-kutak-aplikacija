package rs.biokutak.remote;
import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.JsResult;
public class MainActivity extends Activity {
 @Override public void onCreate(Bundle b){super.onCreate(b);getWindow().setStatusBarColor(0xFF100B12);getWindow().setNavigationBarColor(0xFF100B12);WebView w=new WebView(this);w.setBackgroundColor(0xFF100B12);WebSettings s=w.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(true);s.setAllowContentAccess(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);w.setWebViewClient(new WebViewClient());w.setWebChromeClient(new WebChromeClient(){@Override public boolean onJsConfirm(WebView v,String u,String m,JsResult r){r.confirm();return true;}});setContentView(w);w.loadUrl("file:///android_asset/index.html");}
}