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
 Future<void> _draw() async {if(!loaded||busy)return;final pack=packs[selected];if(pack.winner!=null||!prizePool.any((p)=>p.drawable))return;setState(()=>busy=true);await anim.forward(from:0);final list=prizePool.where((p)=>p.drawable).toList();if(list.isEmpty){if(mounted)setState(()=>busy=false);return;}final total=list.fold<int>(0,(sum,p)=>sum+p.weight);var r=Random.secure().nextInt(total);var win=list.first;for(final p in list){r-=p.weight;if(r<0){win=p;break;}}win.stock--;pack.winner=win.name;if(win.stock==0)win.active=false;history.insert(0,'${DateTime.now().toString().substring(0,16)} • PAKET ${selected+1} • ${win.name}');await _save();if(mounted){setState(() { reveal=win.name; busy=false; });await _showPrizeReveal(selected,win.name);}}
 Future<void> _showPrizeReveal(int packageNumber,String prizeName) async {
    await showGeneralDialog<void>(
      context:context, barrierDismissible:true, barrierLabel:'Zatvori poklon',
      barrierColor:Colors.black.withOpacity(.9), transitionDuration:const Duration(milliseconds:650),
      pageBuilder:(context,animation,secondary)=>Center(child:Material(color:Colors.transparent,child:Container(
        margin:const EdgeInsets.all(24),padding:const EdgeInsets.all(28),constraints:const BoxConstraints(maxWidth:620),
        decoration:BoxDecoration(
          gradient:const LinearGradient(begin:Alignment.topLeft,end:Alignment.bottomRight,colors:[Color(0xFF4B0712),Color(0xFF9D1026),Color(0xFF3A0610)]),
          borderRadius:BorderRadius.circular(30),border:Border.all(color:const Color(0xFFFFD978),width:3),
          boxShadow:[BoxShadow(color:const Color(0xFFFFC247).withOpacity(.55),blurRadius:55,spreadRadius:8)],
        ),
        child:Column(mainAxisSize:MainAxisSize.min,children:[
          const Text('15 GODINA SA BIO KUTAK',textAlign:TextAlign.center,style:TextStyle(color:Color(0xFFFFE6A0),fontSize:18,fontWeight:FontWeight.w900,letterSpacing:2)),
          const SizedBox(height:22),
          ScaleTransition(scale:CurvedAnimation(parent:animation,curve:Curves.elasticOut),child:Container(
            width:190,height:170,decoration:BoxDecoration(gradient:const LinearGradient(colors:[Color(0xFFFFE7A0),Color(0xFFFFB52E),Color(0xFFB20D25)]),borderRadius:BorderRadius.circular(24),border:Border.all(color:Colors.white,width:2),boxShadow:[BoxShadow(color:Colors.amber.withOpacity(.5),blurRadius:28)]),
            child:const Column(mainAxisAlignment:MainAxisAlignment.center,children:[Icon(Icons.card_giftcard,size:76,color:Color(0xFF7B0718)),Text('POKLON',style:TextStyle(color:Color(0xFF7B0718),fontSize:18,fontWeight:FontWeight.w900,letterSpacing:3))]),
          )),
          const SizedBox(height:24),
          const Text('ČESTITAMO!',style:TextStyle(color:Color(0xFFFFD978),fontSize:30,fontWeight:FontWeight.w900,letterSpacing:2)),
          const SizedBox(height:8),
          Text('PAKET ${packageNumber+1}',style:const TextStyle(color:Colors.white70,fontSize:16,fontWeight:FontWeight.bold,letterSpacing:2)),
          const SizedBox(height:10),
          Text(prizeName,textAlign:TextAlign.center,style:const TextStyle(color:Colors.white,fontSize:32,fontWeight:FontWeight.w900)),
          const SizedBox(height:22),
          FilledButton(style:FilledButton.styleFrom(backgroundColor:const Color(0xFFFFD978),foregroundColor:const Color(0xFF5B0715),padding:const EdgeInsets.symmetric(horizontal:36,vertical:16)),onPressed:()=>Navigator.pop(context),child:const Text('ZATVORI',style:TextStyle(fontWeight:FontWeight.w900,letterSpacing:1))),
        ]),
      ))),
      transitionBuilder:(context,animation,secondary,child)=>FadeTransition(opacity:animation,child:ScaleTransition(scale:CurvedAnimation(parent:animation,curve:Curves.easeOutBack),child:child)),
    );
  }
  Future<void> _newCustomer() async {if(busy)return;final yes=await showDialog<bool>(context:context,builder:(c)=>AlertDialog(backgroundColor:panel,title:const Text('NOVI KUPAC'),content:const Text('Otključati svih 15 paketa za sledećeg kupca? Zalihe nagrada ostaju sačuvane.'),actions:[TextButton(onPressed:()=>Navigator.pop(c,false),child:const Text('ODUSTANI')),FilledButton(onPressed:()=>Navigator.pop(c,true),child:const Text('NOVI KUPAC'))]));if(yes!=true)return;for(final p in packs){p.winner=null;}selected=0;reveal=null;await anim.reverse();await _save();if(mounted)setState((){});}
 Future<void> _login() async {final ctl=TextEditingController();final ok=await showDialog<bool>(context:context,builder:(c)=>AlertDialog(backgroundColor:panel,title:const Text('ADMINISTRACIJA'),content:TextField(controller:ctl,obscureText:true,autofocus:true,keyboardType:TextInputType.number,decoration:const InputDecoration(labelText:'Administratorski PIN'),onSubmitted:(_)=>Navigator.pop(c,ctl.text=='1515')),actions:[TextButton(onPressed:()=>Navigator.pop(c,false),child:const Text('ODUSTANI')),FilledButton(onPressed:()=>Navigator.pop(c,ctl.text=='1515'),child:const Text('ULAZ'))]));ctl.dispose();if(ok==true&&mounted)await _admin();}
 Future<Prize?> _editPrize(Prize? old) async {final n=TextEditingController(text:old?.name??'');final s=TextEditingController(text:(old?.stock??1).toString());final w=TextEditingController(text:(old?.weight??10).toString());bool active=old?.active??true;final result=await showDialog<Prize>(context:context,builder:(c)=>StatefulBuilder(builder:(c,refresh)=>AlertDialog(backgroundColor:panel,title:Text(old==null?'DODAJ NAGRADU':'IZMENI NAGRADU'),content:SizedBox(width:420,child:SingleChildScrollView(child:Column(mainAxisSize:MainAxisSize.min,children:[TextField(controller:n,decoration:const InputDecoration(labelText:'Naziv nagrade')),TextField(controller:s,keyboardType:TextInputType.number,decoration:const InputDecoration(labelText:'Količina na stanju')),TextField(controller:w,keyboardType:TextInputType.number,decoration:const InputDecoration(labelText:'Verovatnoća / težina')),SwitchListTile(value:active,activeColor:rose,title:const Text('Nagrada je aktivna'),subtitle:const Text('Neaktivne nagrade se ne izvlače'),onChanged:(v)=>refresh(()=>active=v))]))),actions:[TextButton(onPressed:()=>Navigator.pop(c),child:const Text('OTKAŽI')),FilledButton(onPressed:(){final qty=int.tryParse(s.text),weight=int.tryParse(w.text);if(n.text.trim().isEmpty||qty==null||qty<0||weight==null||weight<0)return;Navigator.pop(c,Prize(n.text.trim(),qty,weight,active:active&&qty>0));},child:const Text('SAČUVAJ'))])));n.dispose();s.dispose();w.dispose();return result;}
 Future<void> _admin() async {
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, refresh) => Dialog(
          backgroundColor: panel,
          insetPadding: const EdgeInsets.all(18),
          child: SizedBox(
            width: 760, height: 620,
            child: Column(children: [
              Padding(padding: const EdgeInsets.fromLTRB(22,16,12,12), child: Row(children: [
                const Icon(Icons.tune,color:rose,size:26), const SizedBox(width:12),
                const Expanded(child: Text('ZAJEDNIČKI FOND NAGRADA',style:TextStyle(fontWeight:FontWeight.w900,fontSize:18,letterSpacing:1))),
                IconButton(onPressed:()=>Navigator.pop(dialogContext),icon:const Icon(Icons.close)),
              ])),
              const Divider(height:1),
              Padding(padding:const EdgeInsets.fromLTRB(20,12,20,10),child:Row(children:[
                Expanded(child:Text('${prizePool.length} VRSTA NAGRADA • ${prizePool.fold<int>(0,(sum,p)=>sum+p.stock)} UKUPNO KOMADA',style:const TextStyle(color:muted,fontSize:12,fontWeight:FontWeight.bold))),
                FilledButton.icon(onPressed:()async{final prize=await _editPrize(null);if(prize!=null){setState(()=>prizePool.add(prize));await _save();refresh((){});}},icon:const Icon(Icons.add),label:const Text('DODAJ NAGRADU')),
              ])),
              const Divider(height:1),
              Expanded(child:prizePool.isEmpty
                ? const Center(child:Text('Zajednički fond je prazan. Dodaj nagrade ovde — važe za svih 15 paketa.',textAlign:TextAlign.center,style:TextStyle(color:muted)))
                : ListView.builder(padding:const EdgeInsets.all(12),itemCount:prizePool.length,itemBuilder:(context,index){
                    final prize=prizePool[index];
                    return Card(color:panel2,child:ListTile(
                      leading:CircleAvatar(backgroundColor:prize.drawable?rose.withOpacity(.2):Colors.white10,child:Icon(prize.drawable?Icons.card_giftcard:Icons.block,color:prize.drawable?rose:muted)),
                      title:Text(prize.name,style:const TextStyle(fontWeight:FontWeight.bold)),
                      subtitle:Text('Zaliha: ${prize.stock} • Težina: ${prize.weight} • ${prize.active?"Aktivna":"Neaktivna"}',style:const TextStyle(color:muted)),
                      trailing:Wrap(children:[
                        IconButton(onPressed:()async{final value=await _editPrize(prize);if(value!=null){setState(()=>prizePool[index]=value);await _save();refresh((){});}},icon:const Icon(Icons.edit_outlined)),
                        IconButton(onPressed:()async{
                          final yes=await showDialog<bool>(context:dialogContext,builder:(ctx)=>AlertDialog(backgroundColor:panel,title:const Text('Obrisati nagradu?'),content:Text(prize.name),actions:[
                            TextButton(onPressed:()=>Navigator.pop(ctx,false),child:const Text('NE')),
                            FilledButton(onPressed:()=>Navigator.pop(ctx,true),child:const Text('OBRIŠI')),
                          ]));
                          if(yes==true){setState(()=>prizePool.removeAt(index));await _save();refresh((){});}
                        },icon:const Icon(Icons.delete_outline,color:Colors.redAccent)),
                      ]),
                    ));
                  }),
              ),
              Padding(padding:const EdgeInsets.all(14),child:Row(children:[
                Expanded(child:Text('Istorija izvlačenja: ${history.length}',style:const TextStyle(color:muted))),
                FilledButton(onPressed:()async{await _save();if(dialogContext.mounted)Navigator.pop(dialogContext);},child:const Text('SAČUVAJ I ZATVORI')),
              ])),
            ]),
          ),
        ),
      ),
    );
    if(mounted)setState((){});
  }
  Widget _giftTile(int i,double width){
 final pack=packs[i],opened=pack.winner!=null,active=selected==i,available=prizePool.any((p)=>p.drawable);
 return GestureDetector(onTap:()=>_select(i),child:AnimatedScale(scale:active?1.055:1,duration:const Duration(milliseconds:220),child:Container(
  decoration:BoxDecoration(gradient:LinearGradient(begin:Alignment.topLeft,end:Alignment.bottomRight,colors:active?[const Color(0xFFFFE7A0),const Color(0xFFD98A19),const Color(0xFF8B101B)]:[const Color(0xFFFFF4DC),const Color(0xFFE8C68B),const Color(0xFFB87524)]),borderRadius:BorderRadius.circular(13),border:Border.all(color:active?Colors.white:const Color(0xFFFFD76A),width:active?3:1.5),boxShadow:[BoxShadow(color:Colors.amber.withOpacity(active?.55:.25),blurRadius:active?18:8,spreadRadius:active?2:0)]),
  child:Stack(alignment:Alignment.center,children:[
   Positioned.fill(child:Padding(padding:EdgeInsets.symmetric(horizontal:width*.12),child:Container(decoration:BoxDecoration(color:const Color(0xFFB20F20),border:Border.symmetric(vertical:BorderSide(color:const Color(0xFFFFD76A).withOpacity(.9),width:2)))))),
   Positioned(top:0,left:0,right:0,height:width*.15,child:Container(decoration:BoxDecoration(color:const Color(0xFFFFF0D0),borderRadius:const BorderRadius.vertical(top:Radius.circular(11)),border:Border.all(color:const Color(0xFFFFD76A))))),
   Positioned(top:width*.10,child:Icon(Icons.card_giftcard,color:const Color(0xFFFFE7A0),size:width*.28,shadows:const [Shadow(color:Colors.black54,blurRadius:5)])),
   Positioned(bottom:width*.06,child:Container(width:width*.54,height:width*.54,alignment:Alignment.center,decoration:BoxDecoration(shape:BoxShape.circle,gradient:const LinearGradient(colors:[Color(0xFFFFF2B4),Color(0xFFE7A52C)]),border:Border.all(color:const Color(0xFF9B4C12),width:2),boxShadow:const [BoxShadow(color:Colors.black45,blurRadius:5)]),child:Text('${i+1}',style:TextStyle(color:const Color(0xFF7C0A17),fontSize:width*.32,fontWeight:FontWeight.w900)))),
   if(opened)Positioned.fill(child:Container(decoration:BoxDecoration(color:Colors.black.withOpacity(.48),borderRadius:BorderRadius.circular(13)),child:const Icon(Icons.check_circle,color:Color(0xFFFFE39A),size:28))),
   if(!available&&!opened)Positioned.fill(child:Container(decoration:BoxDecoration(color:Colors.black.withOpacity(.45),borderRadius:BorderRadius.circular(13)),child:const Icon(Icons.lock_outline,color:Colors.white70,size:25))),
  ]),
 )));
}
Widget _newPremiumHome(BoxConstraints box){
 final landscape=box.maxWidth>=box.maxHeight;
 final headline=landscape?box.maxHeight*.105:box.maxHeight*.10;
 return Stack(fit:StackFit.expand,children:[
  const DecoratedBox(decoration:BoxDecoration(gradient:RadialGradient(center:Alignment(0,-.15),radius:1.15,colors:[Color(0xFF7A210D),Color(0xFF26070B),Color(0xFF080405)]))),
  Positioned.fill(child:CustomPaint(painter:AnniversarySparkPainter())),
  SafeArea(child:Padding(padding:EdgeInsets.fromLTRB(landscape?22:12,landscape?8:8,landscape?22:12,landscape?12:8),child:Column(children:[
   Row(mainAxisAlignment:MainAxisAlignment.center,children:[
    Text('15',style:TextStyle(fontSize:headline*1.18,fontWeight:FontWeight.w900,letterSpacing:-4,color:const Color(0xFFFFD65C),shadows:const [Shadow(color:Color(0xFFFF9D00),blurRadius:24),Shadow(color:Colors.white,blurRadius:4)])),
    const SizedBox(width:12),
    Flexible(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
     Text('GODINA',style:TextStyle(fontSize:headline*.56,fontWeight:FontWeight.w900,letterSpacing:2,color:const Color(0xFFFFE8A2),shadows:const [Shadow(color:Colors.black87,blurRadius:5)])),
     Text('SA BIO KUTAK',style:TextStyle(fontSize:headline*.34,fontWeight:FontWeight.w900,letterSpacing:2,color:Colors.white)),
    ])),
    const Spacer(),
    IconButton(onPressed:_login,icon:Icon(Icons.settings,color:const Color(0xFFFFD76A),size:landscape?30:24)),
   ]),
   SizedBox(height:landscape?5:2),
   Text('IZABERI SVOJ POKLON',style:TextStyle(color:const Color(0xFFFFE9B0),fontWeight:FontWeight.w900,letterSpacing:landscape?4:2,fontSize:landscape?14:11,shadows:const [Shadow(color:Colors.black,blurRadius:8)])),
   const SizedBox(height:7),
   Expanded(child:LayoutBuilder(builder:(context,gridBox){
    final tileW=(gridBox.maxWidth-4*(landscape?14:7))/5;
    final tileH=(gridBox.maxHeight-2*(landscape?12:6))/3;
    final tileSize=min(tileW,tileH*1.2);
    return Center(child:ConstrainedBox(constraints:BoxConstraints(maxWidth:tileSize*5+4*(landscape?14:7)),child:GridView.builder(physics:const NeverScrollableScrollPhysics(),padding:EdgeInsets.zero,itemCount:15,gridDelegate:SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount:5,crossAxisSpacing:landscape?14:7,mainAxisSpacing:landscape?12:6,childAspectRatio:landscape?1.04:.88),itemBuilder:(context,i)=>_giftTile(i,tileSize))));
   })),
   Row(children:[
    Expanded(child:Text('DOSTUPNO PAKETA: ${packs.where((p)=>p.winner==null&&prizePool.any((x)=>x.drawable)).length}/15',style:TextStyle(color:const Color(0xFFFFE9B0),fontWeight:FontWeight.bold,fontSize:landscape?13:10,letterSpacing:1))),
    OutlinedButton.icon(onPressed:_newCustomer,icon:const Icon(Icons.person_add_alt_1,size:18),label:const Text('NOVI KUPAC'),style:OutlinedButton.styleFrom(foregroundColor:const Color(0xFFFFE6A0),side:const BorderSide(color:Color(0xFFFFD76A),width:1.5),backgroundColor:Colors.black26)),
    const SizedBox(width:6),
    FilledButton.icon(onPressed:busy||packs[selected].winner!=null||!prizePool.any((p)=>p.drawable)?null:_draw,icon:const Icon(Icons.redeem),label:const Text('OTVORI'),style:FilledButton.styleFrom(backgroundColor:const Color(0xFFB20F20),foregroundColor:Colors.white)),
   ]),
  ]))),
 ]);
}
@override Widget build(BuildContext context){
 return Focus(autofocus:true,focusNode:remote,onKeyEvent:_remoteKey,child:Scaffold(body:LayoutBuilder(builder:(context,box)=>_newPremiumHome(box))));
}
}

class AnniversarySparkPainter extends CustomPainter{
 @override void paint(Canvas canvas,Size size){
  final p=Paint()..style=PaintingStyle.fill;final rnd=Random(15);
  for(var i=0;i<125;i++){final x=rnd.nextDouble()*size.width;final y=rnd.nextDouble()*size.height;final r=1+rnd.nextDouble()*2.4;p.color=const Color(0xFFFFD36A).withOpacity(.18+rnd.nextDouble()*.55);canvas.drawCircle(Offset(x,y),r,p);}
  final glow=Paint()..shader=RadialGradient(colors:[const Color(0xFFFFC247).withOpacity(.22),Colors.transparent]).createShader(Rect.fromCircle(center:Offset(size.width*.5,size.height*.55),radius:size.width*.55));canvas.drawRect(Offset.zero&size,glow);
 }
 @override bool shouldRepaint(covariant CustomPainter oldDelegate)=>false;
}
