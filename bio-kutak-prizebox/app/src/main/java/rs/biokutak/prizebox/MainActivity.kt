package rs.biokutak.prizebox

import android.app.Activity
import android.app.AlertDialog
import android.os.Bundle
import android.graphics.*
import android.view.*
import android.view.animation.DecelerateInterpolator
import android.animation.ValueAnimator
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.*
import kotlin.random.Random

data class Prize(var name:String, var stock:Int, var weight:Int, var enabled:Boolean=true)
data class Pack(val name:String, val prizes:MutableList<Prize>)

class MainActivity:Activity(){
    private lateinit var board:PrizeBoard
    private val packs= mutableListOf<Pack>()
    private var selected=0
    private var opening=false
    private var revealed:String?=null
    private var adminPin="1515"
    override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState)
        window.decorView.systemUiVisibility=(View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
        load(); board=PrizeBoard(this); setContentView(board)
    }
    private fun defaults(){packs.clear(); for(i in 1..15)packs.add(Pack("PAKET %02d".format(i), mutableListOf(Prize("Poklon iznenađenja",5,60),Prize("Vaučer 200 RSD",3,30),Prize("Specijalni poklon",1,10))))}
    private fun load(){defaults(); val raw=getSharedPreferences("bk15",0).getString("data",null)?:return; try{val a=JSONArray(raw); for(i in 0 until minOf(15,a.length())){val o=a.getJSONObject(i); val p=packs[i];p.prizes.clear();val q=o.getJSONArray("prizes");for(j in 0 until q.length()){val x=q.getJSONObject(j);p.prizes.add(Prize(x.optString("name"),x.optInt("stock"),x.optInt("weight"),x.optBoolean("enabled",true)))}}}catch(_:Exception){}}
    private fun save(){val a=JSONArray();packs.forEach{p->val o=JSONObject();val q=JSONArray();p.prizes.forEach{x->q.put(JSONObject().put("name",x.name).put("stock",x.stock).put("weight",x.weight).put("enabled",x.enabled))};o.put("prizes",q);a.put(o)};getSharedPreferences("bk15",0).edit().putString("data",a.toString()).apply()}
    private fun available(p:Pack)=p.prizes.any{it.enabled&&it.stock>0&&it.weight>0}
    private fun open(){if(opening||!available(packs[selected]))return;opening=true;revealed=null;board.invalidate();board.animateOpen{val list=packs[selected].prizes.filter{it.enabled&&it.stock>0&&it.weight>0};val sum=list.sumOf{it.weight};var n=Random.nextInt(sum);val win=list.first{n-=it.weight;n<0};win.stock--;save();revealed=win.name;opening=false;board.invalidate()}}
    private fun next(){revealed=null;selected=0;board.invalidate()}
    private fun admin(){val input=android.widget.EditText(this);input.hint="PIN";input.inputType=2;AlertDialog.Builder(this).setTitle("BIO KUTAK – ADMIN").setMessage("Unesi administratorski PIN").setView(input).setPositiveButton("OTKLJUČAJ"){_,_->if(input.text.toString()==adminPin)editPack() else AlertDialog.Builder(this).setMessage("Pogrešan PIN").setPositiveButton("OK",null).show()}.setNegativeButton("ODUSTANI",null).show()}
    private fun editPack(){val p=packs[selected];val names=p.prizes.map{"${it.name}  |  stanje: ${it.stock}  |  težina: ${it.weight}"}.toMutableList();names.add("＋ DODAJ NAGRADU");AlertDialog.Builder(this).setTitle(p.name+" – nagrade").setItems(names.toTypedArray()){_,which->if(which==p.prizes.size)addPrize() else editPrize(which)}.setNeutralButton("RESET SVIH ZALIHA"){_,_->defaults();save();board.invalidate()}.setPositiveButton("ZATVORI",null).show()}
    private fun editPrize(index:Int){val p=packs[selected].prizes[index];val box=android.widget.LinearLayout(this);box.orientation=1;val name=android.widget.EditText(this);name.setText(p.name);val stock=android.widget.EditText(this);stock.inputType=2;stock.setText(p.stock.toString());val weight=android.widget.EditText(this);weight.inputType=2;weight.setText(p.weight.toString());box.addView(name);box.addView(stock);box.addView(weight);AlertDialog.Builder(this).setTitle("Izmeni nagradu").setMessage("Naziv / zaliha / težina").setView(box).setPositiveButton("SAČUVAJ"){_,_->p.name=name.text.toString().ifBlank{"Nagrada"};p.stock=stock.text.toString().toIntOrNull()?.coerceAtLeast(0)?:p.stock;p.weight=weight.text.toString().toIntOrNull()?.coerceAtLeast(0)?:p.weight;save();board.invalidate();editPack()}.setNegativeButton("ODUSTANI",null).setNeutralButton("OBRIŠI"){_,_->packs[selected].prizes.removeAt(index);save();board.invalidate();editPack()}.show()}
    private fun addPrize(){val box=android.widget.LinearLayout(this);box.orientation=1;val name=android.widget.EditText(this);name.hint="Naziv nagrade";val stock=android.widget.EditText(this);stock.hint="Zaliha";stock.inputType=2;stock.setText("1");val weight=android.widget.EditText(this);weight.hint="Težina";weight.inputType=2;weight.setText("10");box.addView(name);box.addView(stock);box.addView(weight);AlertDialog.Builder(this).setTitle("Nova nagrada").setView(box).setPositiveButton("DODAJ"){_,_->packs[selected].prizes.add(Prize(name.text.toString().ifBlank{"Nova nagrada"},stock.text.toString().toIntOrNull()?:1,weight.text.toString().toIntOrNull()?:10));save();board.invalidate();editPack()}.setNegativeButton("ODUSTANI",null).show()}
    inner class PrizeBoard(ctx:Context):View(ctx){
        private val paint=Paint(3);private var progress=0f;private val gold=Color.rgb(231,190,104);private val cream=Color.rgb(255,231,177);private val burgundy=Color.rgb(92,13,34)
        fun animateOpen(done:()->Unit){ValueAnimator.ofFloat(0f,1f).apply{duration=2600;interpolator=DecelerateInterpolator(1.8f);addUpdateListener{progress=it.animatedValue as Float;invalidate()};addListener(object:android.animation.AnimatorListenerAdapter(){override fun onAnimationEnd(animation:android.animation.Animator){done()}});start()}}
        override fun onDraw(c:Canvas){super.onDraw(c);val w=width.toFloat();val h=height.toFloat();c.drawColor(Color.rgb(22,7,13));val bg=Paint(3);bg.shader=RadialGradient(w*.5f,h*.48f,w*.7f,intArrayOf(Color.rgb(91,28,48),Color.rgb(34,9,19),Color.rgb(15,5,9)),null,Shader.TileMode.CLAMP);c.drawRect(0f,0f,w,h,bg)
            text(c,"BIO KUTAK",w*.06f,h*.075f,cream,h*.035f,true);text(c,"15 GODINA ZAJEDNO",w*.5f,h*.075f,gold,h*.027f,true,Paint.Align.CENTER);text(c,"HVALA ŠTO STE DEO NAŠE PRIČE",w*.5f,h*.13f,cream,h*.018f,true,Paint.Align.CENTER)
            val left=w*.045f;val top=h*.22f;val gap=w*.012f;val cw=(w*.48f-gap*4)/5;val ch=h*.115f
            for(i in 0..14){val col=i%5;val row=i/5;val x=left+col*(cw+gap);val y=top+row*(ch+gap);val p=Paint(3);p.color=if(i==selected)Color.rgb(143,65,42) else Color.rgb(49,17,28);p.style=Paint.Style.FILL;c.drawRoundRect(x,y,x+cw,y+ch,12f,12f,p);p.color=if(i==selected)cream else gold;p.style=Paint.Style.STROKE;p.strokeWidth=if(i==selected)4f else 1.5f;c.drawRoundRect(x,y,x+cw,y+ch,12f,12f,p);val av=available(packs[i]);text(c,"%02d".format(i+1),x+cw*.16f,y+ch*.43f,if(av)cream else Color.GRAY,ch*.25f,true);text(c,if(av)"POKLON" else "PRAZNO",x+cw*.16f,y+ch*.76f,if(av)gold else Color.GRAY,ch*.12f,true);if(!av){p.style=Paint.Style.FILL;p.color=Color.BLACK and 0x66000000;c.drawRoundRect(x,y,x+cw,y+ch,12f,12f,p)}}
            val gx=w*.72f;val gy=h*.36f;val bw=w*.19f;val bh=h*.31f
            val glow=Paint(3);glow.color=0x44f3c66e;c.drawCircle(gx+bw/2,gy+bh/2,bw*.8f,glow)
            val body=Paint(3);body.shader=LinearGradient(gx,gy,gx+bw,gy+bh,intArrayOf(0xff650f28.toInt(),0xffc53a4c.toInt(),0xff70142a.toInt()),null,Shader.TileMode.CLAMP);c.drawRoundRect(gx,gy+bh*.22f,gx+bw,gy+bh,8f,8f,body)
            val lid=Paint(3);lid.color=0xffb52d43.toInt();c.drawRoundRect(gx-bw*.06f,gy+bh*.12f,gx+bw*1.06f,gy+bh*.35f,8f,8f,lid);val rib=Paint(3);rib.shader=LinearGradient(gx+bw*.42f,0f,gx+bw*.6f,0f,0xff9b6b28.toInt(),0xffffe5a0.toInt(),Shader.TileMode.CLAMP);c.drawRect(gx+bw*.42f,gy+bh*.13f,gx+bw*.6f,gy+bh,rib);c.drawRect(gx-bw*.05f,gy+bh*.24f,gx+bw*1.05f,gy+bh*.36f,rib)
            if(progress>0){val lp=Paint(3);lp.color=gold;c.save();c.rotate(-progress*85,gx+bw*.5f,gy+bh*.25f);c.drawRoundRect(gx-bw*.06f,gy+bh*.12f-progress*bh*.55f,gx+bw*1.06f,gy+bh*.35f-progress*bh*.55f,8f,8f,lp);c.restore()}
            text(c,"PAKET %02d".format(selected+1),gx+bw/2,gy+bh*1.17f,cream,h*.024f,true,Paint.Align.CENTER)
            if(revealed!=null){text(c,"ČESTITAMO!",w*.73f,h*.76f,cream,h*.027f,true,Paint.Align.CENTER);text(c,revealed!!,w*.73f,h*.81f,gold,h*.023f,true,Paint.Align.CENTER);button(c,"SLEDEĆI KUPAC",w*.65f,h*.86f,w*.82f,h*.94f)}
            else if(opening){text(c,"OTVARANJE POKLONA…",w*.73f,h*.78f,cream,h*.022f,true,Paint.Align.CENTER)}
            else {button(c,"OTVORI POKLON",w*.65f,h*.78f,w*.82f,h*.88f);text(c,"IZABERI PAKET, PA OTVORI POKLON",w*.73f,h*.93f,gold,h*.012f,true,Paint.Align.CENTER)}
            text(c,"ADMIN  ⚙",w*.96f,h*.07f,gold,h*.017f,true,Paint.Align.RIGHT)
        }
        private fun text(c:Canvas,s:String,x:Float,y:Float,color:Int,size:Float,bold:Boolean,align:Paint.Align=Paint.Align.LEFT){paint.shader=null;paint.color=color;paint.textSize=size;paint.typeface=if(bold)Typeface.create("sans-serif",Typeface.BOLD) else Typeface.create("sans-serif",Typeface.NORMAL);paint.textAlign=align;c.drawText(s,x,y,paint)}
        private fun button(c:Canvas,s:String,l:Float,t:Float,r:Float,b:Float){val p=Paint(3);p.shader=LinearGradient(l,t,r,b,0xffe5bd70.toInt(),0xff8c4a26.toInt(),Shader.TileMode.CLAMP);c.drawRoundRect(l,t,r,b,12f,12f,p);text(c,s,(l+r)/2,(t+b)/2+h*.008f,0xff2b1017.toInt(),h*.022f,true,Paint.Align.CENTER)}
        override fun onTouchEvent(e:MotionEvent):Boolean{if(e.action!=MotionEvent.ACTION_UP)return true;val w=width.toFloat();val h=height.toFloat();val x=e.x;val y=e.y
            if(x>w*.88f&&y<h*.13f){admin();return true}
            if(revealed!=null){if(x>w*.62f&&y>h*.84f)next();invalidate();return true}
            if(!opening&&x<w*.55f&&y>h*.2f&&y<h*.64f){val left=w*.045f;val top=h*.22f;val gap=w*.012f;val cw=(w*.48f-gap*4)/5;val ch=h*.115f;val col=((x-left)/(cw+gap)).toInt();val row=((y-top)/(ch+gap)).toInt();if(col in 0..4&&row in 0..2){val i=row*5+col;if(available(packs[i]))selected=i};invalidate();return true}
            if(!opening&&x>w*.62f&&y>h*.74f&&y<h*.92f)open();return true}
        override fun onKeyDown(keyCode:Int,event:KeyEvent):Boolean{when(keyCode){KeyEvent.KEYCODE_DPAD_LEFT->selected=(selected+14)%15;KeyEvent.KEYCODE_DPAD_RIGHT->selected=(selected+1)%15;KeyEvent.KEYCODE_DPAD_UP->selected=(selected+10)%15;KeyEvent.KEYCODE_DPAD_DOWN->selected=(selected+5)%15;KeyEvent.KEYCODE_DPAD_CENTER,KeyEvent.KEYCODE_ENTER->{if(revealed!=null)next() else open()};KeyEvent.KEYCODE_MENU->{admin();return true};else->return super.onKeyDown(keyCode,event)};invalidate();return true}
    }
}
