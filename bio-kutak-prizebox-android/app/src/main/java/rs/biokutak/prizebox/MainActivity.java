package rs.biokutak.prizebox;
import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowManager;
import android.widget.Toast;
import android.net.wifi.WifiManager;
import android.text.format.Formatter;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ConcurrentLinkedQueue;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private WebView webView;
    private ServerSocket server;
    private volatile boolean running=true;
    private volatile String stateJson="{\"prizes\":[],\"used\":[],\"history\":[]}";
    private final ConcurrentLinkedQueue<JSONObject> commands=new ConcurrentLinkedQueue<>();
    private final Handler ui=new Handler(Looper.getMainLooper());

    @Override public void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemUi();
        webView=new WebView(this);
        webView.setBackgroundColor(0xFF080508);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        WebSettings s=webView.getSettings();
        s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true); s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false); s.setSupportZoom(false);
        webView.addJavascriptInterface(new BoxBridge(),"BKBox");
        webView.setWebViewClient(new WebViewClient(){
            @Override public void onPageFinished(WebView v,String url){
                v.evaluateJavascript("(function(){if(window.__bkRemoteLoop)return;window.__bkRemoteLoop=true;setInterval(function(){try{BKBox.publishState(localStorage.getItem('bk15_shared_prizes_v3')||'{}');BKBox.poll();}catch(e){}},500);})();",null);
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
        webView.requestFocus();
        startServer();
        ui.postDelayed(()->Toast.makeText(this,"BIO KUTAK daljinski: "+getWifiIp()+":8787",Toast.LENGTH_LONG).show(),1800);
    }

    private String getWifiIp(){
        try{WifiManager w=(WifiManager)getApplicationContext().getSystemService(WIFI_SERVICE);return Formatter.formatIpAddress(w.getConnectionInfo().getIpAddress());}
        catch(Exception e){return "IP nije dostupan";}
    }
    private class BoxBridge {
        @JavascriptInterface public void publishState(String value){if(value!=null&&value.length()<200000)stateJson=value;}
        @JavascriptInterface public void poll(){JSONObject c;while((c=commands.poll())!=null)dispatch(c);}
    }

    private void dispatch(JSONObject c){
        String action=c.optString("action","");
        if("draw".equals(action)){
            int index=c.optInt("pack",-1);
            if(index>=0&&index<15)ui.post(()->webView.evaluateJavascript(
                "(function(){try{var a=document.querySelectorAll('.hotspot');var b=a["+index+"];if(!b)return 'NO_PACKAGE_BUTTON';b.click();return 'DRAW_TRIGGERED';}catch(e){return 'ERROR:'+e.message;}})()",null));
        }else if("newCustomer".equals(action)){
            ui.post(()->webView.evaluateJavascript("document.getElementById('newCustomer').click()",null));
        }else if("setPrizes".equals(action)){
            org.json.JSONArray prizes=c.optJSONArray("prizes");
            if(prizes!=null)ui.post(()->webView.evaluateJavascript("window.BKRemoteSetPrizes && window.BKRemoteSetPrizes("+prizes.toString()+")",null));
        }else if("editWinner".equals(action)){
            int index=c.optInt("index",-1);String buyer=JSONObject.quote(c.optString("buyer",""));
            ui.post(()->webView.evaluateJavascript("(function(){try{var s=JSON.parse(localStorage.getItem('bk15_shared_prizes_v3')||'{}');if(s.history&&s.history["+index+"]){s.history["+index+"].buyer="+buyer+";localStorage.setItem('bk15_shared_prizes_v3',JSON.stringify(s));}}catch(e){}})()",null));
        }else if("deleteWinner".equals(action)){
            int index=c.optInt("index",-1);
            ui.post(()->webView.evaluateJavascript("(function(){try{var s=JSON.parse(localStorage.getItem('bk15_shared_prizes_v3')||'{}');var w=s.history&&s.history["+index+"];if(w){s.history.splice("+index+",1);s.used=(s.used||[]).filter(function(x){return x!==w.pack-1});var p=(s.prizes||[]).find(function(x){return x.name===w.prize});if(p)p.stock++;localStorage.setItem('bk15_shared_prizes_v3',JSON.stringify(s));}}catch(e){}})()",null));
        }
    }

    private String readLine(InputStream in)throws IOException{
        ByteArrayOutputStream b=new ByteArrayOutputStream();int c;
        while((c=in.read())!=-1){if(c=='\n')break;if(c!='\r')b.write(c);}
        return b.toString("UTF-8");
    }
    private void startServer(){
        new Thread(()->{try{
            server=new ServerSocket(8787,20,InetAddress.getByName("0.0.0.0"));
            while(running){Socket socket=server.accept();new Thread(()->handle(socket)).start();}
        }catch(Exception ignored){}}, "bk-local-server").start();
    }
    private void handle(Socket socket){
        try(Socket s=socket;InputStream in=s.getInputStream();OutputStream out=s.getOutputStream()){
            String line=readLine(in);if(line==null||line.isEmpty())return;
            String[] first=line.split(" ");String method=first[0];String path=first.length>1?first[1]:"/";
            int length=0;String h;
            while((h=readLine(in))!=null&&!h.isEmpty())if(h.toLowerCase().startsWith("content-length:"))length=Integer.parseInt(h.substring(15).trim());
            byte[] body=new byte[Math.min(length,200000)];int read=0;
            while(read<body.length){int n=in.read(body,read,body.length-read);if(n<0)break;read+=n;}
            String payload=new String(body,0,read,StandardCharsets.UTF_8);
            String response;int code=200;
            if("OPTIONS".equals(method))response="{}";
            else if(path.startsWith("/state"))response=stateJson;
            else if(path.startsWith("/cmd")&&"POST".equals(method)){commands.add(new JSONObject(payload));response="{\"ok\":true}";}
            else if(path.startsWith("/ping"))response="{\"ok\":true,\"device\":\"BIO KUTAK BOX\"}";
            else{code=404;response="{\"error\":\"not found\"}";}
            byte[] bytes=response.getBytes(StandardCharsets.UTF_8);
            String status=code==200?"200 OK":"404 Not Found";
            out.write(("HTTP/1.1 "+status+"\r\nContent-Type: application/json; charset=utf-8\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nContent-Length: "+bytes.length+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            out.write(bytes);out.flush();
        }catch(Exception ignored){}
    }
    private void hideSystemUi(){getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_STABLE);}
    @Override public void onWindowFocusChanged(boolean f){super.onWindowFocusChanged(f);if(f)hideSystemUi();}
    @Override protected void onDestroy(){running=false;try{if(server!=null)server.close();}catch(Exception ignored){}super.onDestroy();}
    @Override public void onBackPressed(){}
}
