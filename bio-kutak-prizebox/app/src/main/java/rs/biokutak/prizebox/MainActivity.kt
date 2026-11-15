package rs.biokutak.prizebox

import android.app.Activity
import android.app.AlertDialog
import android.os.Bundle
import android.graphics.*
import android.view.*
import android.view.animation.DecelerateInterpolator
import android.animation.ValueAnimator
import android.content.Context
import android.widget.EditText
import android.widget.LinearLayout
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.*
import kotlin.random.Random

data class Prize(var name:String,var stock:Int,var weight:Int,var enabled:Boolean=true)

class MainActivity:Activity(){
    private lateinit var board:PrizeBoard
    private val prizes=mutableListOf<Prize>()
    private val used=BooleanArray(15)
    private var selected=0
    private var opening=false
    private var revealed:String?=null
    private val prefs by lazy{getSharedPreferences("bk15_shared_prizes",0)}
    override fun onCreate(savedInstanceState:Bundle?){
        super.onCreate(savedInstanceState)
        window.decorView.systemUiVisibility=(View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
        load()
        for(i in used.indices)used[i]=false
        board=PrizeBoard(this);setContentView(board)
    }
    private fun load(){
        prizes.clear()
        val raw=prefs.getString("pool",null)?:return
        try{val a=JSONArray(raw);for(i in 0 until a.length()){val o=a.getJSONObject(i);prizes.add(Prize(o.optString("name"),o.optInt("stock"),o.optInt("weight",1),o.optBoolean("enabled",true)))}}catch(_:Exception){}
    }
    private fun save(){
        val a=JSONArray()
        prizes.forEach{a.put(JSONObject().put("name",it.name).put("stock",it.stock).put("weight",it.weight).put("enabled",it.enabled))}
        prefs.edit().putString("pool",a.toString()).apply()
    }
    private fun available()=prizes.any{it.enabled&&it.stock>0&&it.weight>0}
    private fun newCustomer(){for(i in used.indices)used[i]=false;selected=0;revealed=null;opening=false;board.invalidate()}
    private fun openPrize(){
        if(opening||used[selected]||!available())return
        opening=true;revealed=null;board.animateOpen{
            val eligible=prizes.filter{it.enabled&&it.stock>0&&it.weight>0}
            if(eligible.isNotEmpty()){
                val total=eligible.sumOf{it.weight.coerceAtLeast(0)}
                var pick=Random.nextInt(total)
                val win=eligible.first{pick-=it.weight;pick<0}
                win.stock=(win.stock-1).coerceAtLeast(0)
                if(win.stock==0)win.enabled=false
                used[selected]=true;save();revealed=win.name
            }
            opening=false;board.invalidate()
        }
    }
    private fun admin(){
        val input=EditText(this).apply{hint="Administratorski PIN";inputType=2}
        AlertDialog.Builder(this).setTitle("BIO KUTAK – ADMIN").setMessage("Unesi PIN za administraciju").setView(input)
            .setPositiveButton("ULAZ"){_,_->if(input.text.toString()=="1515")editPool() else AlertDialog.Builder(this).setMessage("Pogrešan PIN").setPositiveButton("OK",null).show()}
            .setNegativeButton("ODUSTANI",null).show()
    }
    private fun editPool(){
        val items=prizes.map{"\${it.name}  |  stanje: \${it.stock}  |  težina: \${it.weight}  |  \${if(it.enabled)"AKTIVNA" else "NEAKTIVNA"}"}.toMutableList()
        items.add("＋ DODAJ NAGRADU U ZAJEDNIČKI FOND")
        AlertDialog.Builder(this).setTitle("ZAJEDNIČKI FOND NAGRADA").setItems(items.toTypedArray()){_,i->if(i==prizes.size)addPrize() else editPrize(i)}.setPositiveButton("ZATVORI",null).show()
    }
    private fun prizeEditor(prize:Prize?,index:Int=-1){
        val box=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(28,8,28,8)}
        val name=EditText(this).apply{hint="Naziv nagrade";setText(prize?.name?:"")}
        val stock=EditText(this).apply{hint="Količina na stanju";inputType=2;setText(prize?.stock?.toString()?:"1")}
        val weight=EditText(this).apply{hint="Verovatnoća / težina";inputType=2;setText(prize?.weight?.toString()?:"10")}
        box.addView(name);box.addView(stock);box.addView(weight)
        val builder=AlertDialog.Builder(this).setTitle(if(prize==null)"Dodaj nagradu u zajednički fond" else "Izmeni nagradu").setView(box)
            .setPositiveButton("SAČUVAJ"){_,_->
                val n=name.text.toString().trim().ifBlank{"Nagrada"}
                val q=stock.text.toString().toIntOrNull()?.coerceAtLeast(0)?:0
                val w=weight.text.toString().toIntOrNull()?.coerceAtLeast(0)?:0
                if(prize==null)prizes.add(Prize(n,q,w,q>0&&w>0)) else {prize.name=n;prize.stock=q;prize.weight=w;prize.enabled=q>0&&w>0}
                save();board.invalidate();editPool()
            }.setNegativeButton("ODUSTANI",null)
        if(prize!=null)builder.setNeutralButton("OBRIŠI"){_,_->prizes.removeAt(index);save();board.invalidate();editPool()}
        builder.show()
    }
    private fun addPrize()=prizeEditor(null)
    private fun editPrize(i:Int)=prizeEditor(prizes[i],i)

    inner class PrizeBoard(ctx:Context):View(ctx){
        private val p=Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        private val gold=Color.rgb(255,211,105)
        private val cream=Color.rgb(255,239,195)
        private val artwork=BitmapFactory.decodeResource(resources,R.drawable.bio_kutak_15)
        private var progress=0f
        private val imageRect=RectF()
        private val giftRects=ArrayList<RectF>()
        init{isFocusable=true;isFocusableInTouchMode=true;requestFocus()}
        fun animateOpen(done:()->Unit){
            ValueAnimator.ofFloat(0f,1f).apply{duration=1750;interpolator=DecelerateInterpolator(1.5f);addUpdateListener{progress=it.animatedValue as Float;invalidate()};addListener(object:android.animation.AnimatorListenerAdapter(){override fun onAnimationEnd(animation:android.animation.Animator){done()}});start()}
        }
        private fun layoutImage(w:Float,h:Float){
            val side=min(w,h);val l=(w-side)/2f;val t=(h-side)/2f
            imageRect.set(l,t,l+side,t+side);giftRects.clear()
            val xs=floatArrayOf(.04f,.225f,.405f,.59f,.775f,.96f)
            val ys=floatArrayOf(.405f,.575f,.745f,.92f)
            for(row in 0..2)for(col in 0..4)giftRects.add(RectF(l+side*xs[col],t+side*ys[row],l+side*xs[col+1],t+side*ys[row+1]))
        }
        override fun onDraw(c:Canvas){
            super.onDraw(c);val w=width.toFloat();val h=height.toFloat();c.drawColor(Color.rgb(8,5,7))
            p.shader=BitmapShader(artwork,Shader.TileMode.CLAMP,Shader.TileMode.CLAMP)
            val save=c.save();c.translate(w/2f,h/2f);val scale=max(w/artwork.width,h/artwork.height);c.scale(scale,scale);c.translate(-artwork.width/2f,-artwork.height/2f)
            p.color=0x66300000;c.drawBitmap(artwork,0f,0f,p);c.restoreToCount(save);p.shader=null
            layoutImage(w,h);p.color=Color.WHITE;p.alpha=255;c.drawBitmap(artwork,null,imageRect,p)
            p.color=gold;p.style=Paint.Style.STROKE;p.strokeWidth=max(1f,h*.002f);c.drawRoundRect(imageRect,8f,8f,p);p.style=Paint.Style.FILL
            pill(c,"NOVI KUPAC",w*.79f,h*.035f,w*.955f,h*.105f,cream)
            pill(c,"⚙",w*.955f,h*.035f,w*.99f,h*.105f,gold)
            val chosen=giftRects[selected];val ui=Paint(Paint.ANTI_ALIAS_FLAG)
            if(!used[selected]){ui.color=0xFFFFD76A.toInt();ui.style=Paint.Style.STROKE;ui.strokeWidth=max(3f,h*.006f);c.drawRoundRect(chosen,18f,18f,ui);ui.style=Paint.Style.FILL;ui.color=0x33FFE6A0;c.drawRoundRect(chosen,18f,18f,ui)}
            else{ui.color=0x99000000.toInt();c.drawRoundRect(chosen,18f,18f,ui)}
            if(opening){
                val cx=chosen.centerX();val cy=chosen.centerY();val z=1f+progress*1.65f;val sw=chosen.width()*z;val sh=chosen.height()*z
                ui.color=Color.WHITE;ui.style=Paint.Style.STROKE;ui.strokeWidth=5f+progress*8f;c.drawRoundRect(cx-sw/2,cy-sh/2,cx+sw/2,cy+sh/2,24f,24f,ui);ui.style=Paint.Style.FILL
                ui.color=0x55FFD56B;c.drawCircle(cx,cy,progress*min(w,h)*.27f,ui)
                text(c,"OTVARANJE POKLONA…",w/2f,h*.94f,cream,h*.025f,true,Paint.Align.CENTER)
            }
            if(revealed!=null){
                ui.color=0xE90A0608.toInt();c.drawRoundRect(w*.22f,h*.28f,w*.78f,h*.76f,30f,30f,ui)
                ui.color=gold;ui.style=Paint.Style.STROKE;ui.strokeWidth=4f;c.drawRoundRect(w*.22f,h*.28f,w*.78f,h*.76f,30f,30f,ui);ui.style=Paint.Style.FILL
                text(c,"ČESTITAMO!",w/2f,h*.40f,cream,h*.055f,true,Paint.Align.CENTER)
                text(c,"PAKET \${selected+1}",w/2f,h*.48f,gold,h*.03f,true,Paint.Align.CENTER)
                text(c,revealed!!,w/2f,h*.59f,Color.WHITE,h*.045f,true,Paint.Align.CENTER)
                pill(c,"SLEDEĆI KUPAC",w*.37f,h*.66f,w*.63f,h*.72f,cream)
            }else if(!opening){
                val status=when{!available()->"NAGRADNI FOND JE PRAZAN";used[selected]->"OVAJ POKLON JE VEĆ IZVUČEN";else->"IZABRANI POKLON: \${selected+1}"}
                text(c,status,w/2f,h*.965f,cream,h*.018f,true,Paint.Align.CENTER)
            }
        }
        private fun pill(c:Canvas,s:String,l:Float,t:Float,r:Float,b:Float,color:Int){
            val q=Paint(Paint.ANTI_ALIAS_FLAG);q.color=0xDD170A0D.toInt();c.drawRoundRect(l,t,r,b,22f,22f,q);q.color=color;q.style=Paint.Style.STROKE;q.strokeWidth=2f;c.drawRoundRect(l,t,r,b,22f,22f,q);q.style=Paint.Style.FILL
            text(c,s,(l+r)/2f,(t+b)/2f+height*.008f,color,height*.022f,true,Paint.Align.CENTER)
        }
        private fun text(c:Canvas,s:String,x:Float,y:Float,color:Int,size:Float,bold:Boolean,align:Paint.Align=Paint.Align.LEFT){
            p.shader=null;p.alpha=255;p.color=color;p.textSize=size;p.textAlign=align;p.typeface=if(bold)Typeface.create("sans-serif",Typeface.BOLD) else Typeface.create("sans-serif",Typeface.NORMAL);c.drawText(s,x,y,p)
        }
        override fun onTouchEvent(e:MotionEvent):Boolean{
            if(e.action!=MotionEvent.ACTION_UP)return true
            val x=e.x;val y=e.y;val w=width.toFloat();val h=height.toFloat()
            if(x>w*.955f&&y<h*.13f){admin();return true}
            if(x>w*.79f&&y<h*.13f){newCustomer();return true}
            if(revealed!=null){newCustomer();invalidate();return true}
            if(!opening){layoutImage(w,h);val idx=giftRects.indexOfFirst{it.contains(x,y)};if(idx>=0){selected=idx;invalidate();openPrize();return true}}
            return true
        }
        override fun onKeyDown(keyCode:Int,event:KeyEvent):Boolean{
            when(keyCode){KeyEvent.KEYCODE_DPAD_LEFT->selected=(selected+14)%15;KeyEvent.KEYCODE_DPAD_RIGHT->selected=(selected+1)%15;KeyEvent.KEYCODE_DPAD_UP->selected=(selected+10)%15;KeyEvent.KEYCODE_DPAD_DOWN->selected=(selected+5)%15;KeyEvent.KEYCODE_DPAD_CENTER,KeyEvent.KEYCODE_ENTER->{if(revealed!=null)newCustomer() else openPrize()};KeyEvent.KEYCODE_MENU->admin();else->return super.onKeyDown(keyCode,event)}
            invalidate();return true
        }
    }
}
