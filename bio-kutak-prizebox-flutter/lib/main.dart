import 'dart:convert';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

const bg=Color(0xFF100D10), panel=Color(0xFF1D171C), panel2=Color(0xFF281D24), rose=Color(0xFFB83B60), cream=Color(0xFFF4E8DF), muted=Color(0xFFB9AAB1);
Future<void> main() async { WidgetsFlutterBinding.ensureInitialized(); await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky); runApp(const BioApp()); }

class Prize {
 String name; int stock,weight; bool active;
 Prize(this.name,this.stock,this.weight,{this.active=true});
 bool get drawable=>active&&stock>0&&weight>0;
 Map<String,dynamic> toJson()=>{'name':name,'stock':stock,'weight':weight,'active':active};
 factory Prize.fromJson(Map<String,dynamic> j)=>Prize((j['name']??'Nagrada').toString(),(j['stock'] as num? ?? 0).toInt(),(j['weight'] as num? ?? 1).toInt(),active:j['active'] as bool? ?? true);
}
class PrizePack {
 final int id; List<Prize> prizes; String? winner;
 PrizePack(this.id,this.prizes,{this.winner});
 bool get available=>prizes.any((p)=>p.drawable);
 int get remaining=>prizes.fold(0,(s,p)=>s+p.stock);
 Map<String,dynamic> toJson()=>{'id':id,'winner':winner,'prizes':prizes.map((p)=>p.toJson()).toList()};
 factory PrizePack.fromJson(Map<String,dynamic> j)=>PrizePack((j['id'] as num).toInt(),(j['prizes'] as List).map((e)=>Prize.fromJson(Map<String,dynamic>.from(e))).toList(),winner:j['winner']?.toString());
}
class BioApp extends StatelessWidget {
 const BioApp({super.key});
 @override Widget build(BuildContext c)=>MaterialApp(title:'BIO KUTAK • 15 godina',debugShowCheckedModeBanner:false,theme:ThemeData(useMaterial3:true,brightness:Brightness.dark,scaffoldBackgroundColor:bg,colorScheme:ColorScheme.fromSeed(seedColor:rose,brightness:Brightness.dark)),home:const PrizeHome());
}
class PrizeHome extends StatefulWidget { const PrizeHome({super.key}); @override State<PrizeHome> createState()=>_PrizeHomeState(); }
class _PrizeHomeState extends State<PrizeHome> with SingleTickerProviderStateMixin {
 late List<PrizePack> packs; late List<Prize> prizePool; late AnimationController anim; late Animation<double> turn;
 final FocusNode remote=FocusNode(); int selected=0; bool busy=false,loaded=false; String? reveal; List<String> history=[];
 List<PrizePack> emptyPacks()=>List.generate(15,(i)=>PrizePack(i,<Prize>[]));
 @override void initState(){super.initState();packs=emptyPacks();prizePool=<Prize>[];anim=AnimationController(vsync:this,duration:const Duration(milliseconds:1050));turn=CurvedAnimation(parent:anim,curve:Curves.easeInOutCubic);_load();}
 @override void dispose(){anim.dispose();remote.dispose();super.dispose();}
 Future<void> _load() async {final prefs=await SharedPreferences.getInstance();try{final saved=prefs.getString('bk_prize_packs_v2');if(saved!=null){final decoded=(jsonDecode(saved) as List).map((e)=>PrizePack.fromJson(Map<String,dynamic>.from(e))).toList();if(decoded.length==15){packs=decoded;}}}catch(_){}try{final pool=prefs.getString('bk_prize_pool_v1');if(pool!=null){prizePool=(jsonDecode(pool) as List).map((e)=>Prize.fromJson(Map<String,dynamic>.from(e))).toList();}else{final legacy=<String,Prize>{};for(final pack in packs){for(final prize in pack.prizes){final key=prize.name.trim().toLowerCase();if(!legacy.containsKey(key)){legacy[key]=Prize(prize.name,prize.stock,prize.weight,active:prize.active);}else{legacy[key]!.stock=max(legacy[key]!.stock,prize.stock);}}}prizePool=legacy.values.toList();}}catch(_){prizePool=<Prize>[];}history=prefs.getStringList('bk_prize_history_v2')??[];for(final pack in packs){pack.winner=null;}selected=0;reveal=null;await _save();if(mounted)setState(()=>loaded=true);}
 Future<void> _save() async {final p=await SharedPreferences.getInstance();await p.setString('bk_prize_packs_v2',jsonEncode(packs.map((p)=>p.toJson()).toList()));await p.setString('bk_prize_pool_v1',jsonEncode(prizePool.map((p)=>p.toJson()).toList()));await p.setStringList('bk_prize_history_v2',history);}
 void _select(int i){setState(() { selected=i; reveal=packs[i].winner; });}
 KeyEventResult _remoteKey(FocusNode n,KeyEvent e){if(e is! KeyDownEvent)return KeyEventResult.ignored;final k=e.logicalKey;if(k==LogicalKeyboardKey.arrowLeft){_select((selected-1).clamp(0,14));return KeyEventResult.handled;}if(k==LogicalKeyboardKey.arrowRight){_select((selected+1).clamp(0,14));return KeyEventResult.handled;}if(k==LogicalKeyboardKey.arrowUp){_select((selected-5).clamp(0,14));return KeyEventResult.handled;}if(k==LogicalKeyboardKey.arrowDown){_select((selected+5).clamp(0,14));return KeyEventResult.handled;}if(k==LogicalKeyboardKey.enter||k==LogicalKeyboardKey.select||k==LogicalKeyboardKey.space){_draw();return KeyEventResult.handled;}return KeyEventResult.ignored;}
 Future<void> _draw() async {if(!loaded||busy)return;final pack=packs[selected];if(pack.winner!=null||!prizePool.any((p)=>p.drawable))return;setState(()=>busy=true);await anim.forward(from:0);final list=prizePool.where((p)=>p.drawable).toList();if(list.isEmpty){if(mounted)setState(()=>busy=false);return;}final total=list.fold<int>(0,(sum,p)=>sum+p.weight);var r=Random.secure().nextInt(total);var win=list.first;for(final p in list){r-=p.weight;if(r<0){win=p;break;}}win.stock--;pack.winner=win.name;if(win.stock==0)win.active=false;history.insert(0,'${DateTime.now().toString().substring(0,16)} • PAKET ${selected+1} • ${win.name}');await _save();if(mounted)setState(() { reveal=win.name; busy=false; });}
 Future<void> _newCustomer() async {if(busy)return;final yes=await showDialog<bool>(context:context,builder:(c)=>AlertDialog(backgroundColor:panel,title:const Text('NOVI KUPAC'),content:const Text('Otključati svih 15 paketa za sledećeg kupca? Zalihe nagrada ostaju sačuvane.'),actions:[TextButton(onPressed:()=>Navigator.pop(c,false),child:const Text('ODUSTANI')),FilledButton(onPressed:()=>Navigator.pop(c,true),child:const Text('NOVI KUPAC'))]));if(yes!=true)return;for(final p in packs){p.winner=null;}selected=0;reveal=null;await anim.reverse();await _save();if(mounted)setState((){});}
 Future<void> _login() async {final ctl=TextEditingController();final ok=await showDialog<bool>(context:context,builder:(c)=>AlertDialog(backgroundColor:panel,title:const Text('ADMINISTRACIJA'),content:TextField(controller:ctl,obscureText:true,autofocus:true,keyboardType:TextInputType.number,decoration:const InputDecoration(labelText:'Administratorski PIN'),onSubmitted:(_)=>Navigator.pop(c,ctl.text=='1515')),actions:[TextButton(onPressed:()=>Navigator.pop(c,false),child:const Text('ODUSTANI')),FilledButton(onPressed:()=>Navigator.pop(c,ctl.text=='1515'),child:const Text('ULAZ'))]));ctl.dispose();if(ok==true&&mounted)await _admin();}
 Future<Prize?> _editPrize(Prize? old) async {final n=TextEditingController(text:old?.name??'');final s=TextEditingController(text:(old?.stock??1).toString());final w=TextEditingController(text:(old?.weight??10).toString());bool active=old?.active??true;final result=await showDialog<Prize>(context:context,builder:(c)=>StatefulBuilder(builder:(c,refresh)=>AlertDialog(backgroundColor:panel,title:Text(old==null?'DODAJ NAGRADU':'IZMENI NAGRADU'),content:SizedBox(width:420,child:SingleChildScrollView(child:Column(mainAxisSize:MainAxisSize.min,children:[TextField(controller:n,decoration:const InputDecoration(labelText:'Naziv nagrade')),TextField(controller:s,keyboardType:TextInputType.number,decoration:const InputDecoration(labelText:'Količina na stanju')),TextField(controller:w,keyboardType:TextInputType.number,decoration:const InputDecoration(labelText:'Verovatnoća / težina')),SwitchListTile(value:active,activeColor:rose,title:const Text('Nagrada je aktivna'),subtitle:const Text('Neaktivne nagrade se ne izvlače'),onChanged:(v)=>refresh(()=>active=v))]))),actions:[TextButton(onPressed:()=>Navigator.pop(c),child:const Text('OTKAŽI')),FilledButton(onPressed:(){final qty=int.tryParse(s.text),weight=int.tryParse(w.text);if(n.text.trim().isEmpty||qty==null||qty<0||weight==null||weight<0)return;Navigator.pop(c,Prize(n.text.trim(),qty,weight,active:active&&qty>0));},child:const Text('SAČUVAJ'))])));n.dispose();s.dispose();w.dispose();return result;}
 Future<void> _admin() async {await showDialog<void>(context:context,barrierDismissible:false,builder:(c)=>StatefulBuilder(builder:(c,refresh)=>Dialog(backgroundColor:panel,insetPadding:const EdgeInsets.all(18),child:SizedBox(width:760,height:620,child:Column(children:[
  Padding(padding:const EdgeInsets.fromLTRB(22,16,12,12),child:Row(children:[const Icon(Icons.tune,color:rose,size:26),const SizedBox(width:12),const Expanded(child:Text('ZAJEDNIČKI FOND NAGRADA',style:TextStyle(fontWeight:FontWeight.w900,fontSize:18,letterSpacing:1))),IconButton(onPressed:()=>Navigator.pop(c),icon:const Icon(Icons.close))])),
  const Divider(height:1),
  Padding(padding:const EdgeInsets.fromLTRB(20,12,20,10),child:Row(children:[Expanded(child:Text('${prizePool.length} VRSTA NAGRADA • ${prizePool.fold<int>(0,(sum,p)=>sum+p.stock)} UKUPNO KOMADA',style:const TextStyle(color:muted,fontSize:12,fontWeight:FontWeight.bold))),FilledButton.icon(onPressed:()async{final prize=await _editPrize(null);if(prize!=null){setState(()=>prizePool.add(prize));await _save();refresh((){});}},icon:const Icon(Icons.add),label:const Text('DODAJ NAGRADU'))])),
  const Divider(height:1),
  Expanded(child:prizePool.isEmpty?const Center(child:Text('Zajednički fond je prazan. Dodaj nagrade ovde — važe za svih 15 paketa.',textAlign:TextAlign.center,style:TextStyle(color:muted))):ListView.builder(padding:const EdgeInsets.all(12),itemCount:prizePool.length,itemBuilder:(c,i){final p=prizePool[i];return Card(color:panel2,child:ListTile(leading:CircleAvatar(backgroundColor:p.drawable?rose.withOpacity(.2):Colors.white10,child:Icon(p.drawable?Icons.card_giftcard:Icons.block,color:p.drawable?rose:muted)),title:Text(p.name,style:const TextStyle(fontWeight:FontWeight.bold)),subtitle:Text('Zaliha: ${p.stock} • Težina: ${p.weight} • ${p.active?"Aktivna":"Neaktivna"}',style:const TextStyle(color:muted)),trailing:Wrap(children:[IconButton(onPressed:()async{final v=await _editPrize(p);if(v!=null){setState(()=>prizePool[i]=v);await _save();refresh((){});}},icon:const Icon(Icons.edit_outlined)),IconButton(onPressed:()async{final yes=await showDialog<bool>(context:c,builder:(cc)=>AlertDialog(backgroundColor:panel,title:const Text('Obrisati nagradu?'),content:Text(p.name),actions:[TextButton(onPressed:()=>Navigator.pop(cc,false),child:const Text('NE')),FilledButton(onPressed:()=>Navigator.pop(cc,true),child:const Text('OBRIŠI'))]));if(yes==true){setState(()=>prizePool.removeAt(i));await _save();refresh((){});}},icon:const Icon(Icons.delete_outline,color:Colors.redAccent))])));})),
  Padding(padding:const EdgeInsets.all(14),child:Row(children:[Expanded(child:Text('Istorija izvlačenja: ${history.length}',style:const TextStyle(color:muted))),FilledButton(onPressed:()async{await _save();if(c.mounted)Navigator.pop(c);},child:const Text('SAČUVAJ I ZATVORI'))]))
 ]))));if(mounted)setState((){});}
 Widget _tile(int i){final p=packs[i],active=selected==i,opened=p.winner!=null,empty=!prizePool.any((x)=>x.drawable)&&!opened;return InkWell(onTap:()=>_select(i),borderRadius:BorderRadius.circular(13),child:AnimatedContainer(duration:const Duration(milliseconds:180),decoration:BoxDecoration(color:active?const Color(0xFF462432):panel,borderRadius:BorderRadius.circular(13),border:Border.all(color:active?rose:const Color(0xFF3A2D34),width:active?2:1),boxShadow:active?[BoxShadow(color:rose.withOpacity(.18),blurRadius:16)]:[]),child:Column(mainAxisAlignment:MainAxisAlignment.center,children:[Icon(opened?Icons.check_circle:empty?Icons.lock_outline:Icons.card_giftcard,color:empty?muted:active?cream:rose,size:24),const SizedBox(height:4),Text('PAKET ${i+1}',style:const TextStyle(color:cream,fontWeight:FontWeight.w800,fontSize:13)),Text(opened?'OTVOREN':empty?'PRAZAN':'DOSTUPAN',style:const TextStyle(color:muted,fontSize:9,letterSpacing:1))])));}
 Widget _drawPanel(bool compact){final p=packs[selected];final count=prizePool.where((x)=>x.drawable).length;return Container(padding:EdgeInsets.all(compact?14:20),decoration:BoxDecoration(color:panel,borderRadius:BorderRadius.circular(20),border:Border.all(color:const Color(0xFF3A2D34))),child:Column(mainAxisAlignment:MainAxisAlignment.center,children:[
 const Text('IZABRANI PAKET',style:TextStyle(color:muted,letterSpacing:2,fontSize:10,fontWeight:FontWeight.bold)),const SizedBox(height:4),Text('BROJ ${selected+1}',style:const TextStyle(color:cream,fontSize:21,fontWeight:FontWeight.w900,letterSpacing:2)),const SizedBox(height:12),
 GestureDetector(onTap:_draw,child:AnimatedBuilder(animation:turn,builder:(c,child){final a=turn.value*pi;return Transform(alignment:Alignment.center,transform:Matrix4.identity()..setEntry(3,2,.001)..rotateY(a),child:Container(height:compact?112:165,width:compact?155:205,decoration:BoxDecoration(gradient:const LinearGradient(begin:Alignment.topLeft,end:Alignment.bottomRight,colors:[Color(0xFF703047),Color(0xFF321923)]),borderRadius:BorderRadius.circular(19),border:Border.all(color:const Color(0xFF9B687A),width:1.5),boxShadow:[BoxShadow(color:rose.withOpacity(.14),blurRadius:22)]),child:Transform(alignment:Alignment.center,transform:Matrix4.identity()..rotateY(a>pi/2?pi:0),child:Column(mainAxisAlignment:MainAxisAlignment.center,children:[Icon(reveal==null?Icons.card_giftcard:Icons.workspace_premium,size:compact?40:56,color:const Color(0xFFE7C7D1)),const SizedBox(height:7),Padding(padding:const EdgeInsets.symmetric(horizontal:8),child:Text(reveal??'BIO KUTAK',textAlign:TextAlign.center,maxLines:2,overflow:TextOverflow.ellipsis,style:TextStyle(color:cream,fontWeight:FontWeight.w900,fontSize:compact?13:17))),if(reveal==null)const Text('POKLON IZNENAĐENJA',style:TextStyle(color:muted,fontSize:9,letterSpacing:1))]))));})),
 const SizedBox(height:10),if(reveal!=null)Text('ČESTITAMO!  $reveal',textAlign:TextAlign.center,style:const TextStyle(color:Color(0xFFE9B9C9),fontSize:16,fontWeight:FontWeight.w900))else Text(count==0?'NEMA DOSTUPNIH NAGRADA':'$count VRSTA NAGRADA DOSTUPNO',style:const TextStyle(color:muted,fontSize:10,letterSpacing:1)),
 const SizedBox(height:12),SizedBox(width:double.infinity,height:44,child:FilledButton.icon(onPressed:busy||!prizePool.any((x)=>x.drawable)||p.winner!=null?null:_draw,icon:busy?const SizedBox(width:17,height:17,child:CircularProgressIndicator(strokeWidth:2)):const Icon(Icons.redeem),label:Text(busy?'OTVARANJE…':p.winner!=null?'PAKET JE OTVOREN':'OTVORI POKLON'),style:FilledButton.styleFrom(backgroundColor:rose,foregroundColor:Colors.white,disabledBackgroundColor:const Color(0xFF40363B),textStyle:const TextStyle(fontWeight:FontWeight.w800,letterSpacing:1)))),
 const SizedBox(height:7),Text('PREOSTALO NAGRADA U FONDU: ${prizePool.fold<int>(0,(sum,x)=>sum+x.stock)}',style:const TextStyle(color:muted,fontSize:10))
 ]));}
 @override
 Widget build(BuildContext context) {
  return Focus(
   autofocus: true,
   focusNode: remote,
   onKeyEvent: _remoteKey,
   child: Scaffold(
    body: Container(
     decoration: const BoxDecoration(
      gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFF21151C), bg, Color(0xFF160E13)]),
     ),
     child: SafeArea(
      child: LayoutBuilder(
       builder: (context, box) {
        final landscape = box.maxWidth >= box.maxHeight;
        final compact = box.maxHeight < 520;
        final header = Row(children: [
         Container(width: 40, height: 40, decoration: BoxDecoration(color: rose.withOpacity(.16), borderRadius: BorderRadius.circular(11), border: Border.all(color: rose.withOpacity(.5))), child: const Icon(Icons.auto_awesome, color: Color(0xFFE7C7D1))),
         const SizedBox(width: 10),
         const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('BIO KUTAK', style: TextStyle(color: cream, fontWeight: FontWeight.w900, fontSize: 19, letterSpacing: 2)),
          Text('15 GODINA ZAJEDNO', style: TextStyle(color: Color(0xFFE0A8BB), fontSize: 9, letterSpacing: 2, fontWeight: FontWeight.bold)),
         ]),
         const Spacer(),
         if (landscape) const Text('POKLONI ZA NAŠE KUPCE', style: TextStyle(color: muted, letterSpacing: 2, fontSize: 10)),
         const Spacer(),
         if (landscape) OutlinedButton.icon(onPressed: _newCustomer, icon: const Icon(Icons.person_add_alt_1, size: 16), label: const Text('NOVI KUPAC'), style: OutlinedButton.styleFrom(foregroundColor: cream, side: const BorderSide(color: Color(0xFFD9B86B)))),
         const SizedBox(width: 8),
         IconButton(onPressed: _login, icon: const Icon(Icons.settings_outlined, color: cream)),
        ]);
        final grid = GridView.builder(
         padding: EdgeInsets.zero,
         itemCount: 15,
         physics: const NeverScrollableScrollPhysics(),
         gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 5, mainAxisSpacing: compact ? 5 : 8, crossAxisSpacing: compact ? 5 : 8, childAspectRatio: landscape ? 1.5 : 2.0),
         itemBuilder: (context, i) => _tile(i),
        );
        return Padding(
         padding: EdgeInsets.fromLTRB(compact ? 12 : 20, compact ? 6 : 12, compact ? 12 : 20, compact ? 6 : 12),
         child: Column(children: [
          header,
          SizedBox(height: compact ? 7 : 14),
          Expanded(
           child: landscape
            ? Row(children: [
               Expanded(flex: 5, child: Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: panel.withOpacity(.7), borderRadius: BorderRadius.circular(18), border: Border.all(color: const Color(0xFF342832))),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                 const Padding(padding: EdgeInsets.fromLTRB(4, 2, 4, 8), child: Text('IZABERI JEDAN OD 15 PAKETA', style: TextStyle(color: muted, fontWeight: FontWeight.bold, fontSize: 10, letterSpacing: 1.3))),
                 Expanded(child: grid),
                ]),
               )),
               const SizedBox(width: 14),
               Expanded(flex: 4, child: SingleChildScrollView(child: _drawPanel(true))),
              ])
            : Column(children: [
               SizedBox(height: box.maxHeight * .38, child: grid),
               const SizedBox(height: 8),
               Expanded(child: SingleChildScrollView(child: _drawPanel(true))),
              ]),
          ),
          SizedBox(height: compact ? 6 : 10),
          Row(children: [
           Expanded(child: Text('DOSTUPNO PAKETA: ' + packs.where((p) => prizePool.any((x)=>x.drawable) && p.winner == null).length.toString() + ' / 15', style: const TextStyle(color: muted, fontSize: 10, letterSpacing: 1))),
           if (!landscape) OutlinedButton.icon(onPressed: _newCustomer, icon: const Icon(Icons.person_add_alt_1, size: 16), label: const Text('NOVI KUPAC'), style: OutlinedButton.styleFrom(foregroundColor: cream, side: const BorderSide(color: Color(0xFFD9B86B)))),
           if (!landscape) const SizedBox(width: 7),
           if (!landscape) IconButton(onPressed: _login, icon: const Icon(Icons.admin_panel_settings_outlined, color: muted)),
          ]),
         ]),
        );
       },
      ),
     ),
    ),
   ),
  );
 }
}
