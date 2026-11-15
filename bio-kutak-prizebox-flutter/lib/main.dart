import 'dart:convert';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

const gold = Color(0xFFE9C77D), wine = Color(0xFF4B0C20);
void main() async {
 WidgetsFlutterBinding.ensureInitialized();
 await SystemChrome.setPreferredOrientations([DeviceOrientation.landscapeLeft,DeviceOrientation.landscapeRight]);
 await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
 runApp(const BioKutakApp());
}
class Prize {
 String name; int stock, weight;
 Prize(this.name,this.stock,this.weight);
 Map<String,dynamic> toJson()=>{'name':name,'stock':stock,'weight':weight};
 factory Prize.fromJson(Map<String,dynamic> j)=>Prize(j['name']??'Nagrada',j['stock']??0,j['weight']??1);
}
class Pack {
 int id; List<Prize> prizes; String? winner;
 Pack(this.id,this.prizes,{this.winner});
 bool get available=>prizes.any((p)=>p.stock>0&&p.weight>0);
 Map<String,dynamic> toJson()=>{'id':id,'winner':winner,'prizes':prizes.map((p)=>p.toJson()).toList()};
 factory Pack.fromJson(Map<String,dynamic> j)=>Pack(j['id'],(j['prizes'] as List).map((e)=>Prize.fromJson(Map<String,dynamic>.from(e))).toList(),winner:j['winner']);
}
class BioKutakApp extends StatelessWidget {
 const BioKutakApp({super.key});
 @override Widget build(BuildContext c)=>MaterialApp(title:'BIO KUTAK – 15 godina',debugShowCheckedModeBanner:false,theme:ThemeData(useMaterial3:true,colorScheme:ColorScheme.fromSeed(seedColor:const Color(0xFF8E1839),brightness:Brightness.dark)),home:const PrizeHome());
}
class PrizeHome extends StatefulWidget { const PrizeHome({super.key}); @override State<PrizeHome> createState()=>_PrizeHomeState(); }
class _PrizeHomeState extends State<PrizeHome> with TickerProviderStateMixin {
 late List<Pack> packs; late AnimationController flip; late Animation<double> turn;
 int selected=0; bool busy=false; String? reveal; List<String> history=[];
 List<Pack> defaults()=>List.generate(15,(i)=>Pack(i,[Prize('Poklon iznenađenja',5,60),Prize('Vaučer 200 RSD',3,30),Prize('Specijalni poklon',1,10)]));
 @override void initState(){super.initState();packs=defaults();flip=AnimationController(vsync:this,duration:const Duration(milliseconds:950));turn=CurvedAnimation(parent:flip,curve:Curves.easeInOutBack);_load();}
 @override void dispose(){flip.dispose();super.dispose();}
 Future<void> _load() async {final p=await SharedPreferences.getInstance();try{final s=p.getString('bk_prize_packs');if(s!=null) packs=(jsonDecode(s) as List).map((e)=>Pack.fromJson(Map<String,dynamic>.from(e))).toList();}catch(_){} history=p.getStringList('bk_prize_history')??[];if(mounted)setState((){});}
 Future<void> _save() async {final p=await SharedPreferences.getInstance();await p.setString('bk_prize_packs',jsonEncode(packs.map((e)=>e.toJson()).toList()));await p.setStringList('bk_prize_history',history);}
 Future<void> _draw() async {
  final pack=packs[selected];if(busy||!pack.available||pack.winner!=null)return;
  setState(()=>busy=true);await flip.forward(from:0);
  final list=pack.prizes.where((p)=>p.stock>0&&p.weight>0).toList();final total=list.fold<int>(0,(s,p)=>s+p.weight);
  var n=Random.secure().nextInt(total);var win=list.first;for(final p in list){n-=p.weight;if(n<0){win=p;break;}}
  win.stock--;pack.winner=win.name;history.insert(0,DateTime.now().toString().substring(0,16)+' • PAKET '+(selected+1).toString()+' • '+win.name);
  await _save();if(mounted)setState((){reveal=win.name;busy=false;});
 }
 Future<void> _admin() async {
  final ctl=TextEditingController();final ok=await showDialog<bool>(context:context,builder:(c)=>AlertDialog(backgroundColor:const Color(0xFF29101A),title:const Text('ADMINISTRACIJA'),content:TextField(controller:ctl,obscureText:true,keyboardType:TextInputType.number,decoration:const InputDecoration(labelText:'Administratorski PIN')),actions:[TextButton(onPressed:()=>Navigator.pop(c,false),child:const Text('ODUSTANI')),FilledButton(onPressed:()=>Navigator.pop(c,ctl.text=='1515'),child:const Text('OTKLJUČAJ'))]));ctl.dispose();if(ok==true&&mounted)await _settings();
 }
 Future<Prize?> _editPrize(Prize? old) async {
  final n=TextEditingController(text:old?.name??'');final s=TextEditingController(text:(old?.stock??1).toString());final w=TextEditingController(text:(old?.weight??10).toString());
  final result=await showDialog<Prize>(context:context,builder:(c)=>AlertDialog(backgroundColor:const Color(0xFF29101A),title:Text(old==null?'NOVA NAGRADA':'IZMENI NAGRADU'),content:SizedBox(width:400,child:Column(mainAxisSize:MainAxisSize.min,children:[TextField(controller:n,decoration:const InputDecoration(labelText:'Naziv nagrade')),TextField(controller:s,keyboardType:TextInputType.number,decoration:const InputDecoration(labelText:'Količina na stanju')),TextField(controller:w,keyboardType:TextInputType.number,decoration:const InputDecoration(labelText:'Težina / verovatnoća'))])),actions:[TextButton(onPressed:()=>Navigator.pop(c),child:const Text('ODUSTANI')),FilledButton(onPressed:()=>Navigator.pop(c,Prize(n.text.trim().isEmpty?'Nagrada':n.text.trim(),max(0,int.tryParse(s.text)??0),max(0,int.tryParse(w.text)??0))),child:const Text('SAČUVAJ'))]));
  n.dispose();s.dispose();w.dispose();return result;
 }
 Future<void> _settings() async {
  await showDialog(context:context,builder:(c)=>StatefulBuilder(builder:(c,refresh)=>AlertDialog(backgroundColor:const Color(0xFF29101A),title:const Text('ADMIN • PODEŠAVANJE NAGRADA'),content:SizedBox(width:720,child:SingleChildScrollView(child:Column(mainAxisSize:MainAxisSize.min,children:[
   Wrap(spacing:6,runSpacing:6,children:List.generate(15,(i)=>ChoiceChip(label:Text('PAKET '+(i+1).toString()),selected:selected==i,onSelected:(_){setState(()=>selected=i);refresh((){});}))),
   const SizedBox(height:12),
   ...packs[selected].prizes.asMap().entries.map((e)=>Card(color:const Color(0xFF42182A),child:Row(children:[Expanded(child:Padding(padding:const EdgeInsets.all(8),child:Text(e.value.name))),Text('Zaliha '+e.value.stock.toString()+' • Težina '+e.value.weight.toString()),IconButton(onPressed:()async{final v=await _editPrize(e.value);if(v!=null){setState(()=>packs[selected].prizes[e.key]=v);refresh((){});}},icon:const Icon(Icons.edit)),IconButton(onPressed:(){setState(()=>packs[selected].prizes.removeAt(e.key));refresh((){});},icon:const Icon(Icons.delete,color:Colors.redAccent))]))),
   OutlinedButton.icon(onPressed:()async{final v=await _editPrize(null);if(v!=null){setState(()=>packs[selected].prizes.add(v));refresh((){});}},icon:const Icon(Icons.add),label:const Text('DODAJ NAGRADU')),
   TextButton.icon(onPressed:(){setState(()=>packs=defaults());history.clear();refresh((){});},icon:const Icon(Icons.restart_alt),label:const Text('RESET SVIH PAKETA')),
   Align(alignment:Alignment.centerLeft,child:Text('ISTORIJA IZVLAČENJA ('+history.length.toString()+')',style:const TextStyle(color:gold,fontWeight:FontWeight.bold))),
   ...history.take(8).map((h)=>Align(alignment:Alignment.centerLeft,child:Text(h,style:const TextStyle(fontSize:11)))),
  ]))),actions:[TextButton(onPressed:()=>Navigator.pop(c),child:const Text('ZATVORI'))])));
  await _save();if(mounted)setState((){});
 }
 @override Widget build(BuildContext context) {
  final pack=packs[selected];
  return Scaffold(body:Container(decoration:const BoxDecoration(gradient:RadialGradient(center:Alignment(0,-.2),radius:1.2,colors:[Color(0xFF7A1736),Color(0xFF260914),Color(0xFF10050A)])),child:SafeArea(child:Padding(padding:const EdgeInsets.symmetric(horizontal:26,vertical:14),child:Column(children:[
   Row(children:[GestureDetector(onLongPress:_admin,child:const Icon(Icons.auto_awesome,color:gold,size:32)),const SizedBox(width:10),const Text('BIO KUTAK',style:TextStyle(fontSize:24,letterSpacing:3,fontWeight:FontWeight.w900,color:gold)),const Spacer(),const Column(children:[Text('15 GODINA ZAJEDNO',style:TextStyle(fontSize:22,fontWeight:FontWeight.w900,color:gold,letterSpacing:2)),Text('HVALA ŠTO STE DEO NAŠE PRIČE',style:TextStyle(fontSize:11,letterSpacing:3,color:Colors.white70))]),const Spacer(),IconButton(onPressed:_admin,icon:const Icon(Icons.settings,color:gold))]),
   const SizedBox(height:14),
   Expanded(child:Row(children:[
    Expanded(flex:6,child:GridView.builder(itemCount:15,gridDelegate:const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount:5,mainAxisSpacing:9,crossAxisSpacing:9,childAspectRatio:1.5),itemBuilder:(c,i){final p=packs[i];final active=i==selected;return InkWell(onTap:()=>setState(()=>selected=i),borderRadius:BorderRadius.circular(15),child:AnimatedContainer(duration:const Duration(milliseconds:220),decoration:BoxDecoration(gradient:LinearGradient(colors:active?[const Color(0xFFFFD98D),const Color(0xFFB97835)]:[const Color(0xFF64213A),const Color(0xFF35101F)]),borderRadius:BorderRadius.circular(15),border:Border.all(color:active?Colors.white:gold.withOpacity(.45),width:active?2.5:1),boxShadow:active?[BoxShadow(color:gold.withOpacity(.3),blurRadius:18)]:[]),child:Column(mainAxisAlignment:MainAxisAlignment.center,children:[Icon(p.winner!=null?Icons.check_circle:p.available?Icons.card_giftcard:Icons.lock_outline,color:active?wine:gold,size:25),const SizedBox(height:4),Text('PAKET '+(i+1).toString(),style:TextStyle(color:active?wine:Colors.white,fontWeight:FontWeight.w900,fontSize:14)),Text(p.winner!=null?'OTVOREN':p.available?'IZABERI':'PRAZAN',style:TextStyle(color:active?wine:Colors.white70,fontSize:10,letterSpacing:1))])));})),
    const SizedBox(width:22),
    Expanded(flex:4,child:Column(mainAxisAlignment:MainAxisAlignment.center,children:[
     const Text('TVOJ POKLON TE ČEKA',style:TextStyle(color:gold,fontSize:17,fontWeight:FontWeight.bold,letterSpacing:2)),const SizedBox(height:14),
     GestureDetector(onTap:_draw,child:AnimatedBuilder(animation:turn,builder:(c,child){final a=turn.value*pi;return Transform(alignment:Alignment.center,transform:Matrix4.identity()..setEntry(3,2,.001)..rotateY(a),child:Container(height:185,width:220,decoration:BoxDecoration(gradient:const LinearGradient(colors:[Color(0xFFCF4B5E),Color(0xFF7C102D),Color(0xFF4A0C20)]),borderRadius:BorderRadius.circular(22),border:Border.all(color:gold,width:3),boxShadow:[BoxShadow(color:gold.withOpacity(.25),blurRadius:28)]),child:Transform(alignment:Alignment.center,transform:Matrix4.identity()..rotateY(a>pi/2?pi:0),child:Column(mainAxisAlignment:MainAxisAlignment.center,children:[Icon(reveal==null?Icons.card_giftcard:Icons.workspace_premium,color:gold,size:72),const SizedBox(height:8),Text(reveal??'BIO KUTAK',textAlign:TextAlign.center,style:const TextStyle(color:Colors.white,fontSize:18,fontWeight:FontWeight.w900)),if(reveal==null)const Text('POKLON IZNENAĐENJA',style:TextStyle(color:gold,fontSize:10,letterSpacing:2))]))));})),
     const SizedBox(height:12),Text('PAKET '+(selected+1).toString(),style:const TextStyle(color:Colors.white,fontWeight:FontWeight.bold,fontSize:18,letterSpacing:2)),
     if(reveal!=null)Padding(padding:const EdgeInsets.only(top:8),child:Text('ČESTITAMO!  '+reveal!,textAlign:TextAlign.center,style:const TextStyle(color:gold,fontSize:18,fontWeight:FontWeight.w900))),
     const SizedBox(height:12),SizedBox(width:220,height:48,child:FilledButton.icon(onPressed:busy||!pack.available||pack.winner!=null?null:_draw,icon:const Icon(Icons.redeem),label:Text(busy?'OTVARANJE…':pack.winner!=null?'POKLON OTVOREN':'OTVORI POKLON'),style:FilledButton.styleFrom(backgroundColor:gold,foregroundColor:wine,textStyle:const TextStyle(fontWeight:FontWeight.w900)))),
     const SizedBox(height:9),Text('PREOSTALO NAGRADA: '+pack.prizes.fold<int>(0,(s,p)=>s+p.stock).toString(),style:const TextStyle(color:Colors.white70,fontSize:11,letterSpacing:1)),
    ]))
   ])),
   const SizedBox(height:8),Row(mainAxisAlignment:MainAxisAlignment.spaceBetween,children:[const Text('BIO KUTAK • 15 GODINA ZAJEDNO',style:TextStyle(color:Colors.white54,fontSize:10,letterSpacing:1.5)),Text('DOSTUPNO PAKETA: '+packs.where((p)=>p.available&&p.winner==null).length.toString()+'/15',style:const TextStyle(color:gold,fontSize:11,fontWeight:FontWeight.bold))])
  ])))));
 }
}