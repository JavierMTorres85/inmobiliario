const [MDATA,ZAGG,DDATA,BDATA,DATA_MANIFEST,DATA_RELEASES]=await Promise.all([
 '../data/municipalities.json',
 '../data/zones.json',
 '../data/districts.json',
 '../data/neighborhoods.json',
 '../data/manifest.json',
 '../data/releases.json'
].map(async path=>{
 const response=await fetch(new URL(path,import.meta.url));
 if(!response.ok)throw new Error(`No se pudo cargar ${path}: ${response.status}`);
 return response.json();
}));
const MARR=Object.entries(MDATA).map(([c,d])=>Object.assign({c},d));
const DARR=Object.entries(DDATA).map(([c,d])=>Object.assign({c},d));
const BARR=Object.entries(BDATA).map(([c,d])=>Object.assign({c},d));
const GEO_MUNI=new URL('../data/geo/municipalities.geojson',import.meta.url);
const GEO_DIST=new URL('../data/geo/districts.geojson',import.meta.url);
const GEO_BAR=new URL('../data/geo/neighborhoods.geojson',import.meta.url);
const Z_MUNI=10, Z_DIST=11, Z_BAR=13;
const VALID_METRICS=new Set(['pob','pre','ren','esf','ten']);
const query=new URLSearchParams(location.search);
const queryMetric=query.get('metric'), queryUnit=query.get('unit');
let METRIC=VALID_METRICS.has(queryMetric)?queryMetric:'pob';
let metric=queryUnit==='pct'?'pct':'abs';
let showChanges=query.get('changes')==='1';
let selCode=null, selType='M', simSet=null, simType='M', compareItems=[];
const nparam=(name,fallback)=>{const raw=query.get(name);if(raw==null||raw==='')return fallback;const value=Number(raw);return Number.isFinite(value)?value:fallback;};
const initialView=[nparam('lat',40.42),nparam('lng',-3.72),Math.min(17,Math.max(7,nparam('zoom',9)))];
const map=L.map('map',{preferCanvas:true}).setView(initialView.slice(0,2),initialView[2]);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{attribution:'&copy; CARTO · idealista · INE · Ayto. Madrid · límites: ODS/click_that_hood',maxZoom:17,subdomains:'abcd'}).addTo(map);
let mLayer=null,dLayer=null,bLayer=null,geometryReady=Promise.resolve();
const level=()=>(METRIC==='pob'&&map.getZoom()<Z_MUNI)?'zona':'muni';
function itemFor(lt,code){return arrOf(lt).find(item=>item.c===code);}
function decodeRef(value){const match=/^([MDB]):(.+)$/.exec(value||'');return match?{lt:match[1],code:match[2]}:null;}
function writeState(){
 const center=map.getCenter(),params=new URLSearchParams();
 params.set('metric',METRIC);if(METRIC==='pob')params.set('unit',metric);
 params.set('lat',center.lat.toFixed(5));params.set('lng',center.lng.toFixed(5));params.set('zoom',String(map.getZoom()));
 if(selCode)params.set('zone',`${selType}:${selCode}`);
 if(compareItems.length)params.set('compare',compareItems.map(entry=>`${entry.lt}:${entry.item.c}`).join(','));
 if(showChanges)params.set('changes','1');
 history.replaceState(null,'',`${location.pathname}?${params}${location.hash}`);
}
const MDESC={
 pob:'Crecimiento poblacional: municipios 2020-2025; distritos y barrios de Madrid 2020-2024. Rojo = gana · Azul = pierde. <b>Pincha</b> para la ficha.',
 pre:'Precio de venta €/m² (informe idealista, jun-2026) con serie 2021-2026. Más oscuro = más caro. Zoom sobre Madrid: distritos y barrios. <b>Pincha</b> para ficha con serie y rankings.',
 ren:'Rentabilidad bruta del alquiler = alquiler×12 ÷ precio de venta (idealista 2026). Verde oscuro = renta más. <b>Pincha</b> para la ficha.',
 esf:'Esfuerzo de compra: años de renta íntegra del hogar medio (INE 2023) para una vivienda de 80 m² al precio actual. Morado oscuro = menos asequible. <b>Pincha</b> para la ficha.',
 ten:'Demanda-precio (44 nodos analizados): cruza crecimiento poblacional y tendencia de precio a 5 años. La oferta de anuncios se añadirá cuando esté disponible la API de idealista. <b>Pincha</b> para la ficha.'};
// ---------- color (interpolación OkLab: perceptualmente uniforme — mismo salto de valor, mismo salto percibido) ----------
function _s2l(c){c/=255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);}
function _l2s(c){c=c<=0.0031308?c*12.92:1.055*Math.pow(c,1/2.4)-0.055;return Math.round(Math.max(0,Math.min(1,c))*255);}
function _rgb2ok(r,g,b){r=_s2l(r);g=_s2l(g);b=_s2l(b);
 const l=Math.cbrt(0.4122214708*r+0.5363325363*g+0.0514459929*b),
       m=Math.cbrt(0.2119034982*r+0.6806995451*g+0.1073969566*b),
       s=Math.cbrt(0.0883024619*r+0.2817188376*g+0.6299787005*b);
 return [0.2104542553*l+0.7936177850*m-0.0040720468*s,1.9779984951*l-2.4285922050*m+0.4505937099*s,0.0259040371*l+0.7827717662*m-0.8086757660*s];}
function _ok2rgb(L0,a,b){let l=L0+0.3963377774*a+0.2158037573*b,m=L0-0.1055613458*a-0.0638541728*b,s=L0-0.0894841775*a-1.2914855480*b;
 l=l*l*l;m=m*m*m;s=s*s*s;
 return [_l2s(4.0767416621*l-3.3077115913*m+0.2309699292*s),_l2s(-1.2684380046*l+2.6097574011*m-0.3413193965*s),_l2s(-0.0041960863*l-0.7034186147*m+1.7076147010*s)];}
function _mix(c1,c2,t){const o1=_rgb2ok(c1[0],c1[1],c1[2]),o2=_rgb2ok(c2[0],c2[1],c2[2]);
 const r=_ok2rgb(o1[0]+(o2[0]-o1[0])*t,o1[1]+(o2[1]-o1[1])*t,o1[2]+(o2[2]-o1[2])*t);
 return `rgb(${r[0]},${r[1]},${r[2]})`;}
const _RED=[[247,247,247],[253,219,199],[244,165,130],[214,96,77],[178,24,43],[103,0,31]];
const _BLU=[[247,247,247],[209,229,240],[103,169,207],[67,147,195],[33,102,172],[5,48,97]];
const _YOR=[[255,255,204],[255,237,160],[254,178,76],[253,141,60],[227,26,28],[128,0,38]];
const _GRN=[[247,252,245],[199,233,192],[116,196,118],[35,139,69],[0,90,50],[0,50,25]];
const _PUR=[[252,251,253],[218,218,235],[158,154,200],[106,81,163],[74,20,134],[45,0,75]];
function _rampArr(arr,t){const a=Math.min(Math.max(t,0),1)*(arr.length-1);const i=Math.floor(a);if(i>=arr.length-1)return `rgb(${arr[arr.length-1].join(',')})`;return _mix(arr[i],arr[i+1],a-i);}
function _ramp(s){const arr=s>=0?_RED:_BLU;return _rampArr(arr,Math.abs(s));}
// Escalas: LINEALES valor→color, con recorte robusto p2-p98 (declarado en leyenda) y única por métrica
// (compartida entre municipios, distritos y barrios: el mismo color significa el mismo valor).
// Excepción documentada: población en TOTALES usa raíz cuadrada (distribución extremadamente sesgada:
// Madrid +172.000 vs mediana +300; en lineal todo sería blanco salvo Madrid). La leyenda lleva las marcas reales.
function _pctl(vals,p){const s=[...vals].sort((a,b)=>a-b);const i=(s.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return s[lo]+(s[hi]-s[lo])*(i-lo);}
function robust(vals){if(!vals.length)return [0,1];if(vals.length>20)return [_pctl(vals,0.02),_pctl(vals,0.98)];return [Math.min(...vals),Math.max(...vals)];}
const _BC={};
function allVals(getter){return [...MARR,...DARR,...BARR].map(getter).filter(v=>v!=null&&isFinite(v));}
function bnds(key,getter){if(_BC[key])return _BC[key];return _BC[key]=robust(allVals(getter));}
const GET={pre:x=>x.v,ren:x=>x.rb,esf:x=>x.esf,pobp:x=>x.p!=null?x.p:x.cp,poba:x=>x.a};
function colPob(v,m,lvl){let hi,lo;
 if(lvl==='zona'){const vals=Object.values(ZAGG).map(z=>m==='abs'?z.a:z.p);hi=Math.max(...vals);lo=Math.min(...vals,m==='abs'?-1:-0.1);}
 else{const b=bnds(m==='abs'?'poba':'pobp',GET[m==='abs'?'poba':'pobp']);hi=b[1];lo=Math.min(b[0],m==='abs'?-1:-0.1);}
 let s;
 if(m==='abs'){s=v>=0?Math.sqrt(v)/Math.sqrt(hi):-Math.sqrt(-v)/Math.sqrt(-lo);}
 else{s=v>=0?v/hi:-(v/lo);}
 return _ramp(Math.max(-1,Math.min(1,s)));}
function colSeq(v,arr,rng){const t=(v-rng[0])/(rng[1]-rng[0]);return _rampArr(arr,Math.max(0,Math.min(t,1)));}
const TENCOL={'Caliente':'#d73027','Precio':'#fc8d59','Recorrido':'#2ea043','Fr':'#4575b4'};
function colTen(cu){if(!cu)return '#3a3a3a';for(const k in TENCOL){if(cu.startsWith(k))return TENCOL[k];}return '#3a3a3a';}
const ND='#3a3a3a';
function fillFor(d,lt){ // d=record, lt='M'|'D'|'B'
 if(METRIC==='pob'){
  if(lt==='B'){return d.cp!=null?colPob(d.cp,'pct','muni'):ND;}
  const lvl=(lt==='M')?level():'muni';
  const rec=(lt==='M'&&lvl==='zona')?ZAGG[d.z]:d;
  return colPob(metric==='abs'?rec.a:rec.p,metric,lvl);}
 if(METRIC==='pre'){return d.v?colSeq(d.v,_YOR,bnds('pre',GET.pre)):ND;}
 if(METRIC==='ren'){return d.rb?colSeq(d.rb,_GRN,bnds('ren',GET.ren)):ND;}
 if(METRIC==='esf'){return d.esf?colSeq(d.esf,_PUR,bnds('esf',GET.esf)):ND;}
 if(METRIC==='ten'){return (lt==='B')?ND:colTen(d.cu);}
 return ND;}
// ---------- value accessors ----------
function mv(d,lt){ // active metric value for similarity/rank
 if(METRIC==='pob'){if(lt==='B')return d.cp;return metric==='abs'?d.a:d.p;}
 if(METRIC==='pre')return d.v; if(METRIC==='ren')return d.rb; if(METRIC==='esf')return d.esf; if(METRIC==='ten')return d.te;
 return null;}
function fmtv(x,lt){ if(x==null)return 'n.d.';
 if(METRIC==='pob'){if(lt==='B')return (x>=0?'+':'')+x+'%';return metric==='abs'?num(x)+' hab':(x>=0?'+':'')+x+'%';}
 if(METRIC==='pre')return x.toLocaleString('es')+' €/m²';
 if(METRIC==='ren')return x.toFixed(2)+'%'; if(METRIC==='esf')return x.toFixed(1)+' años'; if(METRIC==='ten')return x.toFixed(2);
 return String(x);}
// ---------- styles ----------
function bordFor(c,lt,base,bw){let bd=base,w=bw;
 if(simSet&&simType===lt&&simSet.has(c)){bd='#2ea043';w=2.6;}
 if(c===selCode&&selType===lt){bd='#ffd400';w=2.8;}
 return [bd,w];}
function styleMuni(f){const c=f.properties.mun_code,d=MDATA[c];
 if(!d) return {fillColor:'#333',color:'#222',weight:.4,fillOpacity:.5};
 const lvl=level();const [bd,w]=bordFor(c,'M',lvl==='zona'?'#111':'#444',lvl==='zona'?0.4:0.7);
 return {fillColor:fillFor(d,'M'),color:bd,weight:w,fillOpacity:.88};}
function styleDist(f){const c=String(f.properties.cartodb_id),d=DDATA[c];
 if(!d) return {fillColor:'#333',color:'#fff',weight:1,fillOpacity:.5};
 const [bd,w]=bordFor(c,'D','#fff',1.1);
 return {fillColor:fillFor(d,'D'),color:bd,weight:w,fillOpacity:.9};}
function styleBar(f){const c=String(f.properties.COD_DISBAR),d=BDATA[c];
 if(!d) return {fillColor:'#333',color:'#ccc',weight:.6,fillOpacity:.5};
 const [bd,w]=bordFor(c,'B','#ddd',0.8);
 return {fillColor:fillFor(d,'B'),color:bd,weight:w,fillOpacity:.9};}
// ---------- tooltips ----------
function tipGen(name,extra,d,lt){let v=mv(d,lt);return `<b>${name}</b>${extra}<br><b>${fmtv(v,lt)}</b><br><i>pincha para la ficha</i>`;}
function tipMuni(f){const d=MDATA[f.properties.mun_code];if(!d)return f.properties.mun_code;
 if(METRIC==='pob'){return `<b>${d.n}</b> &middot; <span style="color:#888">${d.z}</span><br>${d.p20.toLocaleString('es')} &rarr; ${d.p25.toLocaleString('es')}<br><b>${num(d.a)} (${d.p>=0?'+':''}${d.p}%)</b><br><i>pincha para la ficha</i>`;}
 if(METRIC==='ten'){return `<b>${d.n}</b><br><b>${d.cu||'fuera de los 44 nodos analizados'}</b><br><i>pincha para la ficha</i>`;}
 return tipGen(d.n,' &middot; <span style="color:#888">'+d.z+'</span>',d,'M');}
function tipDist(f){const d=DDATA[String(f.properties.cartodb_id)];if(!d)return f.properties.name;
 if(METRIC==='pob'){return `<b>Distrito ${d.n}</b><br>${d.p20.toLocaleString('es')} &rarr; ${d.p25.toLocaleString('es')}<br><b>${num(d.a)} (${d.p>=0?'+':''}${d.p}%)</b><br><i>pincha para la ficha</i>`;}
 if(METRIC==='ten'){return `<b>Distrito ${d.n}</b><br><b>${d.cu||'n.d.'}</b><br><i>pincha para la ficha</i>`;}
 return tipGen('Distrito '+d.n,'',d,'D');}
function tipBar(f){const d=BDATA[String(f.properties.COD_DISBAR)];if(!d)return f.properties.NOMBRE;
 if(METRIC==='ten')return `<b>${d.n}</b><br>tensión solo en municipios y distritos`;
 return tipGen(d.n,' &middot; <span style="color:#888">barrio</span>',d,'B');}
// ---------- ranking / ficha ----------
function ord(n){return n+'º';}
function num(x){return (x>=0?'+':'')+x.toLocaleString('es');}
function rankBy(arr,item,key,asc){const s=arr.filter(x=>x[key]!=null).sort((a,b)=>asc?a[key]-b[key]:b[key]-a[key]);const i=s.findIndex(x=>x.c===item.c);return i<0?null:[i+1,s.length];}
function rk(r){return r?`<span class="rk">${ord(r[0])}</span> de ${r[1]}`:'n.d.';}
function median(arr,key){const v=arr.map(x=>x[key]).filter(x=>x!=null).sort((a,b)=>a-b);return v.length?v[Math.floor(v.length/2)]:null;}
function spark(s){if(!s)return '';const years=[21,22,23,24,25,26];const mx=Math.max(...s),mn=Math.min(...s);
 let h='<div class="sparkbox"><div class="spark">';
 s.forEach((v,i)=>{const t=8+36*(v-mn)/((mx-mn)||1);h+=`<div style="height:${t.toFixed(0)}px" title="jun-20${years[i]}: ${v.toLocaleString('es')} €/m²"><span>'${years[i]}</span></div>`;});
 return h+'</div></div>';}
function arrOf(lt){return lt==='M'?MARR:(lt==='D'?DARR:BARR);}
function uniOf(lt){return lt==='M'?'municipios':(lt==='D'?'distritos':'barrios');}
function qualityBlock(lt){
 const quality=DATA_MANIFEST.metrics[METRIC];
 if(!quality)return '';
 return `<div class="quality"><b>Ficha de calidad del dato</b><br>
 Fuente: ${quality.source}<br>Periodo: ${quality.periods[lt]}<br>
 Tipo: ${quality.kind}<br>Cobertura en ${uniOf(lt)}: ${quality.coverage[lt]}</div>`;
}
function historyPair(item,lt){
 if(METRIC==='pob'&&lt!=='B'&&item.p25!=null&&item.la!=null){
  const currentYear=lt==='D'?'2024':'2025';
  return {label:'Población',oldLabel:String(Number(currentYear)-1),newLabel:currentYear,oldValue:`${(item.p25-item.la).toLocaleString('es')} hab.`,newValue:`${item.p25.toLocaleString('es')} hab.`,note:'Comparación exacta con el último padrón anterior.'};
 }
 if(METRIC==='pob'&&lt==='B'&&item.cp!=null){
  return {label:'Índice de población (2020=100)',oldLabel:'2020',newLabel:'2024',oldValue:'100,0',newValue:(100+item.cp).toLocaleString('es',{minimumFractionDigits:1,maximumFractionDigits:1}),note:'Índice calculado a partir de la variación acumulada publicada.'};
 }
 if(METRIC==='pre'&&item.s?.length>=6){
  return {label:'Precio de venta',oldLabel:'jun-2025',newLabel:'jun-2026',oldValue:`${item.s[4].toLocaleString('es')} €/m²`,newValue:`${item.s[5].toLocaleString('es')} €/m²`,note:'Dos observaciones exactas de la serie publicada.'};
 }
 if(METRIC==='pre'&&item.v!=null&&item.va!=null&&item.va!==-100){
  const previous=Math.round(item.v/(1+item.va/100));
  return {label:'Precio de venta',oldLabel:'corte anterior (estimado)',newLabel:'jun-2026',oldValue:`≈ ${previous.toLocaleString('es')} €/m²`,newValue:`${item.v.toLocaleString('es')} €/m²`,note:'El valor anterior se estima a partir de la variación anual; el actual es el dato publicado.'};
 }
 if(METRIC==='ren'&&item.alq!=null&&item.aa!=null&&item.aa!==-100){
  const previous=item.alq/(1+item.aa/100);
  return {label:'Alquiler usado en el cálculo',oldLabel:'corte anterior (estimado)',newLabel:'2026',oldValue:`≈ ${previous.toLocaleString('es',{maximumFractionDigits:1})} €/m²/mes`,newValue:`${item.alq.toLocaleString('es')} €/m²/mes`,note:'La rentabilidad anterior no se reconstruye sin el precio de venta del mismo corte.'};
 }
 return null;
}
function historyBlock(item,lt){
 if(!showChanges)return '';
 const pair=historyPair(item,lt),release=DATA_RELEASES.releases[0];
 if(!pair)return `<div class="changes"><h3>Qué ha cambiado</h3><div class="note">No existe un valor anterior comparable para esta métrica y zona. Corte versionado actual: ${release?.label||'sin identificar'} (${release?.date||'s.f.'}).</div></div>`;
 return `<div class="changes"><h3>${pair.label}: anterior frente a actual</h3><div class="change-pair"><div class="old"><span>${pair.oldLabel}</span><strong>${pair.oldValue}</strong></div><div class="new"><span>${pair.newLabel}</span><strong>${pair.newValue}</strong></div></div><div class="note"><b>Azul = anterior · naranja = actual.</b> ${pair.note}</div></div>`;
}
function populationValue(item,lt){
 if(lt==='B')return item.cp==null?'n.d.':`${item.cp>=0?'+':''}${item.cp}% (2020-2024)`;
 return item.a==null?'n.d.':`${num(item.a)} hab · ${item.p>=0?'+':''}${item.p}%`;
}
function comparisonValue(item,lt,key){
 if(key==='active')return fmtv(mv(item,lt),lt);
 if(key==='pob')return populationValue(item,lt);
 if(key==='pre')return item.v==null?'n.d.':`${item.v.toLocaleString('es')} €/m²`;
 if(key==='ren')return item.rb==null?'n.d.':`${item.rb.toFixed(2)}%`;
 if(key==='esf')return item.esf==null?'n.d.':`${item.esf.toFixed(1)} años`;
 if(key==='ten')return item.cu?`${item.cu}${item.te==null?'':` (${item.te})`}`:'n.d.';
 return 'n.d.';
}
const COMPARE_ROWS=[['Métrica activa','active'],['Población','pob'],['Precio de venta','pre'],['Rentabilidad bruta','ren'],['Esfuerzo de compra','esf'],['Demanda-precio','ten']];
function comparability(first,second){
 if(!second)return {grade:'medium',label:'Comparación incompleta',detail:'Añade una segunda zona para evaluar periodos y naturaleza de los datos.'};
 const quality=DATA_MANIFEST.metrics[METRIC],periodA=quality.periods[first.lt],periodB=quality.periods[second.lt];
 const missing=mv(first.item,first.lt)==null||mv(second.item,second.lt)==null;
 const derived=/derivad|estimación|índice analítico/i.test(quality.kind);
 let grade='high',label='Comparabilidad alta';
 if(missing||periodA!==periodB){grade='low';label='Comparabilidad baja';}
 else if(first.lt!==second.lt||derived){grade='medium';label='Comparabilidad media';}
 return {grade,label,detail:`${first.item.n}: ${periodA} · ${second.item.n}: ${periodB}. ${quality.kind}.`};
}
function comparabilityBlock(first,second){const state=comparability(first,second);return `<div class="comparability ${state.grade}"><b>${state.label}</b>${state.detail}</div>`;}
function comparisonMatrix(){
 const first=compareItems[0],second=compareItems[1];
 return {first,second,rows:COMPARE_ROWS.map(([label,key])=>[label,first?comparisonValue(first.item,first.lt,key):'',second?comparisonValue(second.item,second.lt,key):''])};
}
function downloadBlob(content,type,filename){const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([content],{type}));link.download=filename;document.body.append(link);link.click();setTimeout(()=>{URL.revokeObjectURL(link.href);link.remove();},0);}
function exportComparison(format){
 const {first,second,rows}=comparisonMatrix(),status=document.getElementById('shareStatus');
 if(!first||!second){status.textContent='Añade dos zonas antes de exportar.';return;}
 const clean=value=>String(value).replace(/<[^>]+>/g,'');
 if(format==='csv'){
  const quote=value=>`"${clean(value).replaceAll('"','""')}"`;
  const csv=[[`Indicador`,`${first.item.n} (${uniOf(first.lt)})`,`${second.item.n} (${uniOf(second.lt)})`],...rows].map(row=>row.map(quote).join(';')).join('\n');
  downloadBlob('\ufeff'+csv,'text/csv;charset=utf-8','comparacion-inmobiliaria.csv');
 }else{
  const xml=value=>clean(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const width=1000,rowHeight=38,height=110+rows.length*rowHeight;
  const rowSvg=rows.map((row,index)=>{const y=98+index*rowHeight;return `<rect x="20" y="${y-24}" width="960" height="34" fill="${index%2?'#f6f6f6':'#ffffff'}"/><text x="35" y="${y}" font-size="14" font-weight="bold">${xml(row[0])}</text><text x="350" y="${y}" font-size="14">${xml(row[1])}</text><text x="675" y="${y}" font-size="14">${xml(row[2])}</text>`;}).join('');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><text x="20" y="32" font-family="Arial" font-size="22" font-weight="bold" fill="#1F4E78">Comparador inmobiliario</text><text x="350" y="65" font-family="Arial" font-size="16" font-weight="bold">${xml(first.item.n)}</text><text x="675" y="65" font-family="Arial" font-size="16" font-weight="bold">${xml(second.item.n)}</text><g font-family="Arial" fill="#222">${rowSvg}</g></svg>`;
  downloadBlob(svg,'image/svg+xml;charset=utf-8','comparacion-inmobiliaria.svg');
 }
 status.textContent=`Comparación exportada en ${format.toUpperCase()}`;setTimeout(()=>{status.textContent='';},3000);
}
function renderCompare(open=true){
 const panel=document.getElementById('compare'),body=document.getElementById('compareBody');
 if(!compareItems.length){panel.style.display='none';body.innerHTML='';writeState();return;}
 const {first,second,rows}=comparisonMatrix();
 body.innerHTML=`${comparabilityBlock(first,second)}<table><thead><tr><th>Indicador</th><th>${first.item.n}<br><small>${uniOf(first.lt)}</small></th><th>${second?`${second.item.n}<br><small>${uniOf(second.lt)}</small>`:'Segunda zona'}</th></tr></thead><tbody>
 ${rows.map(row=>`<tr><th>${row[0]}</th><td>${row[1]}</td><td>${second?row[2]:'Selecciona otra zona y pulsa «Añadir»'}</td></tr>`).join('')}
 </tbody></table><div class="actions">${compareItems.map((entry,index)=>`<button type="button" data-remove-compare="${index}">Quitar ${entry.item.n}</button>`).join('')}<button type="button" data-clear-compare>Vaciar</button><button type="button" class="export" data-export="csv">Exportar CSV</button><button type="button" class="export" data-export="svg">Exportar imagen SVG</button></div>`;
 if(open)panel.style.display='block';
 writeState();
}
function addCompare(){
 const item=itemFor(selType,selCode);if(!item)return;
 if(compareItems.some(entry=>entry.lt===selType&&entry.item.c===item.c)){renderCompare();return;}
 if(compareItems.length===2)compareItems.pop();
 compareItems.push({item,lt:selType});renderCompare();
}
function openInfo(item,lt){
 selCode=item.c; selType=lt; simSet=null;
 const arr=arrOf(lt), tipo=uniOf(lt);
 const sub=lt==='D'?'Distrito de Madrid':(lt==='B'?('Barrio &middot; distrito '+(DDATA[String(item.d)]||{}).n):('Municipio &middot; zona '+item.z));
 let body='';
 if(METRIC==='pob'&&lt!=='B'){
  const anio=lt==='D'?'2024':'2025', prev=lt==='D'?'2023':'2024';
  const media=5.3, momento=item.lp>(item.p/5)*1.25?'acelerando':(item.lp<(item.p/5)*0.7?'desacelerando':'a ritmo estable');
  body=`<div><span class="big">${item.p25.toLocaleString('es')}</span> hab. (${anio})</div>
  <div>${rk(rankBy(arr,item,'p25'))} más poblado</div>
  <div class="sec">Crecimiento 2020-${anio} (5 años)</div>
  <div>${num(item.a)} hab &nbsp;·&nbsp; <b>${item.p>=0?'+':''}${item.p}%</b></div>
  <div>${rk(rankBy(arr,item,'a'))} que más sumó &nbsp;|&nbsp; ${rk(rankBy(arr,item,'p'))} en %</div>
  <div class="sec">Último año (${prev}&rarr;${anio})</div>
  <div>${num(item.la)} hab &nbsp;·&nbsp; <b>${item.lp>=0?'+':''}${item.lp}%</b></div>
  <div>${rk(rankBy(arr,item,'la'))} que más sumó &nbsp;|&nbsp; ${rk(rankBy(arr,item,'lp'))} en %</div>
  <div class="ins">Crece <b>${item.p}%</b> en 5 años, ${item.p>=media?'por encima':'por debajo'} de la media regional (+${media}%). Va <b>${momento}</b> (último año ${item.lp>=0?'+':''}${item.lp}% vs ~${(item.p/5).toFixed(1)}%/año del quinquenio).</div>`;
 } else if(METRIC==='pob'&&lt==='B'){
  body=`<div><span class="big">${item.cp!=null?((item.cp>=0?'+':'')+item.cp+'%'):'n.d.'}</span> población 2020-2024</div>
  <div>${rk(rankBy(arr,item,'cp'))} que más creció (barrios con dato)</div>
  ${item.v?`<div class="sec">Precio</div><div>${item.v.toLocaleString('es')} €/m² ${item.va!=null?('· Δ anual <b>'+(item.va>=0?'+':'')+item.va+'%</b>'):''}</div>`:''}
  <div class="ins">${item.cp!=null?('Padrón del Ayuntamiento 2020→2024.'+(item.cp>10?' Crecimiento fuerte: zona de nueva obra o densificación.':'')):'Sin dato de padrón para la zona idealista equivalente.'}</div>`;
 } else if(METRIC==='pre'){
  const med=median(arr,'v');
  const d5=item.s?Math.round((item.s[5]/item.s[0]-1)*100):null;
  const cagr=item.s?((Math.pow(item.s[5]/item.s[0],1/5)-1)*100):null;
  const momento=(item.va!=null&&cagr!=null)?(item.va>cagr*1.25?'acelerando':(item.va<cagr*0.7?'frenándose':'a ritmo estable')):null;
  body=`<div><span class="big">${item.v?item.v.toLocaleString('es'):'n.d.'}</span> €/m² (jun-2026)</div>
  <div>${rk(rankBy(arr,item,'v'))} más caro de los ${tipo} con dato</div>
  ${item.va!=null?`<div class="sec">Variación anual</div><div><b>${item.va>=0?'+':''}${item.va}%</b> &nbsp;·&nbsp; ${rk(rankBy(arr,item,'va'))} que más sube</div>`:''}
  ${item.s?`<div class="sec">Serie jun-2021 → jun-2026</div>${spark(item.s)}<div>${item.s[0].toLocaleString('es')} → ${item.s[5].toLocaleString('es')} €/m² &nbsp;·&nbsp; <b>+${d5}% en 5 años</b> (${cagr.toFixed(1)}%/año)</div>`:''}
  <div class="ins">${item.v?(`Precio ${item.v>=med?'por encima':'por debajo'} de la mediana de su nivel (${med.toLocaleString('es')} €/m²).`+(momento?` La subida va <b>${momento}</b> (anual ${item.va>=0?'+':''}${item.va}% vs ${cagr.toFixed(1)}%/año del quinquenio).`:'')):'Sin dato de precio en el informe idealista.'}</div>`;
 } else if(METRIC==='ren'){
  const med=median(arr,'rb');
  body=`<div><span class="big">${item.rb?item.rb.toFixed(2)+'%':'n.d.'}</span> rentabilidad bruta anual</div>
  <div>${rk(rankBy(arr,item,'rb'))} donde más renta el alquiler</div>
  ${item.alq?`<div class="sec">Componentes</div><div>Alquiler: <b>${item.alq.toLocaleString('es')} €/m²/mes</b>${item.aa!=null?(' (Δ anual '+(item.aa>=0?'+':'')+item.aa+'%)'):''}</div><div>Venta: <b>${item.v?item.v.toLocaleString('es'):'n.d.'} €/m²</b></div>`:''}
  <div class="ins">${item.rb?(`Cada 100.000 € invertidos generan ~<b>${Math.round(item.rb*1000).toLocaleString('es')} €/año</b> brutos. ${item.rb>=med?'Por encima':'Por debajo'} de la mediana (${med.toFixed(2)}%). Bruta: sin gastos, impuestos ni vacancia.`):'Sin dato de alquiler idealista para calcularla.'}</div>`;
 } else if(METRIC==='esf'){
  const med=median(arr,'esf');
  body=`<div><span class="big">${item.esf?item.esf.toFixed(1):'n.d.'}</span> años de renta del hogar</div>
  <div>${rk(rankBy(arr,item,'esf'))} menos asequible</div>
  ${item.r?`<div class="sec">Componentes</div><div>Vivienda tipo 80 m²: <b>${item.v?(item.v*80).toLocaleString('es'):'n.d.'} €</b></div><div>Renta neta media/hogar (2023): <b>${item.r.toLocaleString('es')} €</b></div>`:''}
  <div class="ins">${item.esf?(`Comprar 80 m² cuesta <b>${item.esf.toFixed(1)} años</b> de renta íntegra del hogar medio, ${item.esf>=med?'peor':'mejor'} que la mediana (${med?med.toFixed(1):'—'}). Ojo: la renta es de quien ya vive ahí; en zonas de inversión el comprador suele venir de fuera.`):'Faltan precio o renta para calcularlo.'}</div>`;
 } else if(METRIC==='ten'){
  const expl={'Caliente':'demanda y precio suben a la vez: mercado tensionado.','Recorrido':'la demanda empuja pero el precio aún va por detrás: donde puede haber recorrido.','Precio':'el precio sube sin empuje demográfico: revisar obra nueva, inversión o escasez.','Fr':'sin tensión apreciable.'};
  let e='';for(const k in expl){if(item.cu&&item.cu.startsWith(k)){e=expl[k];break;}}
  body=`<div><span class="big">${item.cu||'n.d.'}</span></div>
  ${item.te!=null?`<div>Índice demanda-precio: <b>${item.te}</b> &nbsp;·&nbsp; ${rk(rankBy(arr,item,'te'))} más tensionado</div>`:''}
  ${item.s?`<div class="sec">Precio 2021→2026</div><div>${item.s[0].toLocaleString('es')} → ${item.s[5].toLocaleString('es')} €/m² (+${Math.round((item.s[5]/item.s[0]-1)*100)}%)</div>`:''}
  ${METRIC==='ten'&&item.p!=null?`<div class="sec">Demanda</div><div>Población 5 años: <b>${item.p>=0?'+':''}${item.p}%</b></div>`:''}
  <div class="ins">${item.cu?e+' Este índice todavía no incluye la oferta de anuncios; se añadirá cuando esté disponible la API de idealista.':'Fuera de los 44 nodos del análisis demanda-precio (23 municipios tier-A + 21 distritos).'}</div>`;
 }
 body+=historyBlock(item,lt);
 body+=qualityBlock(lt);
 const canSim=mv(item,lt)!=null;
 const inCompare=compareItems.some(entry=>entry.lt===lt&&entry.item.c===item.c);
 const info=document.getElementById('info');
 info.innerHTML=`<div class="hd"><button type="button" class="x" data-action="clear-selection" aria-label="Cerrar ficha">&times;</button><h2>${item.n}</h2><div class="sub">${sub}</div></div>
 <div class="bd">${body}
 <button type="button" class="compare-add" data-action="add-compare">${inCompare?'Ver en el comparador':'Añadir al comparador'}</button>
 ${canSim?`<button type="button" class="sim" data-action="show-similar">Mostrar 20 similares en ${MLAB()}</button>`:''}
 <div id="simbox"></div></div>`;
 info.style.display='block';
 writeState();
 restyle();
}
function MLAB(){return METRIC==='pob'?(metric==='abs'?'crecimiento (totales)':'crecimiento (%)'):(METRIC==='pre'?'precio':(METRIC==='ren'?'rentabilidad':(METRIC==='esf'?'esfuerzo':'demanda-precio')));}
function clearSel(){selCode=null;simSet=null;document.getElementById('info').style.display='none';writeState();restyle();}
function showSim(){
 const arr=arrOf(selType); const self=arr.find(x=>x.c===selCode); if(!self)return;
 const v=mv(self,selType); if(v==null)return;
 const near=arr.filter(x=>x.c!==selCode&&mv(x,selType)!=null).map(x=>({x,d:Math.abs(mv(x,selType)-v)})).sort((a,b)=>a.d-b.d).slice(0,20);
 simSet=new Set(near.map(o=>o.x.c)); simType=selType;
 let html='<div class="clr" style="text-align:center;color:#2ea043;font-weight:bold;margin-top:8px">20 similares en '+MLAB()+'</div><div class="simlist">';
 near.forEach(o=>{html+=`<div><span>${o.x.n}</span><span class="g">${fmtv(mv(o.x,selType),selType)}</span></div>`;});
 html+='</div><button type="button" class="clr" data-action="hide-similar">Quitar resaltado</button>';
 document.getElementById('simbox').innerHTML=html;
 restyle(); fitSim();
}
function hideSim(){simSet=null;document.getElementById('simbox').innerHTML='';restyle();}
function layerOf(lt){return lt==='M'?mLayer:(lt==='D'?dLayer:bLayer);}
function codeOf(l,lt){return lt==='M'?l.feature.properties.mun_code:(lt==='D'?String(l.feature.properties.cartodb_id):String(l.feature.properties.COD_DISBAR));}
function fitZone(lt,code){
 const layer=layerOf(lt);if(!layer)return false;let target=null;
 layer.eachLayer(candidate=>{if(codeOf(candidate,lt)===code)target=candidate;});
 if(!target)return false;
 try{map.fitBounds(target.getBounds(),{padding:[45,45],maxZoom:lt==='B'?15:(lt==='D'?13:11)});return true;}catch(error){return false;}
}
async function focusZone(lt,code){
 const item=itemFor(lt,code);if(!item)return;
 await geometryReady;openInfo(item,lt);
 if(!fitZone(lt,code)&&lt!=='M')map.setView([40.42,-3.70],lt==='B'?14:12);
}
function fitSim(){ if(!simSet)return; const lyr=layerOf(simType); if(!lyr)return; const b=[];
 lyr.eachLayer(l=>{const c=codeOf(l,simType); if(simSet.has(c)||c===selCode){try{b.push(l.getBounds());}catch(e){}}});
 if(b.length){let bb=b[0];for(let i=1;i<b.length;i++)bb=bb.extend(b[i]); map.fitBounds(bb,{padding:[40,40],maxZoom:simType==='B'?14:12});} }
// ---------- labels (nombres por nivel de zoom) ----------
let labM=null,labD=null,labB=null;
function mkLabels(layer,props){const g=L.layerGroup();
 layer.eachLayer(l=>{try{const p=props(l);if(!p)return;
  const m=L.marker(p.c,{icon:L.divIcon({html:'<div class="lbl">'+p.n+'</div>',iconSize:[0,0],className:''}),interactive:false,keyboard:false});
  m._code=p.code;m._pop=p.pop||0;g.addLayer(m);}catch(e){}});
 return g;}
function syncLabels(){const z=map.getZoom();
 const f=(g,show,vis)=>{if(!g)return;
  if(!show){if(map.hasLayer(g))map.removeLayer(g);return;}
  if(!map.hasLayer(g))g.addTo(map);
  g.eachLayer(m=>{const el=m.getElement();if(el)el.style.display=(vis?vis(m):true)?'':'none';});};
 f(labM,z>=Z_MUNI,m=>{if(m._code==='28079'&&z>=Z_DIST)return false; if(z<=Z_MUNI)return m._pop>=20000; if(z===Z_DIST)return m._pop>=5000; return true;});
 f(labD,z>=Z_DIST&&z<Z_BAR,null);
 f(labB,z>=Z_BAR,null);}
// ---------- layers / restyle ----------
function resetStyles(){ if(mLayer) mLayer.setStyle(styleMuni); if(dLayer&&map.hasLayer(dLayer)) dLayer.setStyle(styleDist); if(bLayer&&map.hasLayer(bLayer)) bLayer.setStyle(styleBar); }
function hl(f,l){ if(simSet||selCode) return; const d=MDATA[f.properties.mun_code]; if(!d) return;
 if(METRIC==='pob'&&level()==='zona'&&mLayer){ mLayer.eachLayer(ly=>{ const dd=MDATA[ly.feature.properties.mun_code]; if(dd&&dd.z===d.z){ ly.setStyle({color:'#ffffff',weight:2.2}); ly.bringToFront(); }}); }
 else { l.setStyle({color:'#ffffff',weight:2.2}); l.bringToFront(); } }
function restyle(){
 if(mLayer) mLayer.setStyle(styleMuni);
 const z=map.getZoom();
 if(dLayer){ dLayer.setStyle(styleDist);
   if(z>=Z_DIST&&z<Z_BAR){ if(!map.hasLayer(dLayer)) dLayer.addTo(map); dLayer.bringToFront(); }
   else if(map.hasLayer(dLayer)) map.removeLayer(dLayer); }
 if(bLayer){ bLayer.setStyle(styleBar);
   if(z>=Z_BAR){ if(!map.hasLayer(bLayer)) bLayer.addTo(map); bLayer.bringToFront(); }
   else if(map.hasLayer(bLayer)) map.removeLayer(bLayer); }
 let txt;
 if(z>=Z_BAR) txt='municipios + barrios de Madrid';
 else if(z>=Z_DIST) txt='municipios + distritos de Madrid';
 else txt=(METRIC==='pob'&&z<Z_MUNI)?'zonas (agregado)':'municipios (detalle)';
 document.getElementById('lvl').textContent='Nivel: '+txt; legend(); syncLabels();
}
const LOAD_WARNINGS=[];
function warnLoad(message){LOAD_WARNINGS.push(message);const el=document.getElementById('warnings');el.textContent=LOAD_WARNINGS.join(' · ');el.style.display='block';}
async function loadMuni(){let feats=[];
 try{const r=await fetch(GEO_MUNI);const j=await r.json();feats=(j.features||[]).filter(feature=>MDATA[feature.properties.mun_code]);}
 catch(e){document.getElementById('load').textContent='Error al cargar municipios';warnLoad('No se pudo cargar la geometría municipal.');return false;}
 mLayer=L.geoJSON({type:'FeatureCollection',features:feats},{style:styleMuni,onEachFeature:(f,l)=>{l.bindTooltip(()=>tipMuni(f),{className:'mt',sticky:true});l.on('mouseover',()=>hl(f,l));l.on('mouseout',resetStyles);l.on('click',()=>{const d=MDATA[f.properties.mun_code];if(d)openInfo(Object.assign({c:f.properties.mun_code},d),'M');});}}).addTo(map);
 labM=mkLabels(mLayer,l=>{const c=l.feature.properties.mun_code,d=MDATA[c];return d?{c:l.getBounds().getCenter(),n:d.n,code:c,pop:d.p25}:null;});
 restyle(); return true;
}
async function loadDist(){try{const r=await fetch(GEO_DIST);const gj=await r.json();
 dLayer=L.geoJSON(gj,{style:styleDist,onEachFeature:(f,l)=>{l.bindTooltip(()=>tipDist(f),{className:'mt',sticky:true});l.on('mouseover',()=>{if(simSet||selCode)return;l.setStyle({color:'#fff',weight:2.6});l.bringToFront();});l.on('mouseout',resetStyles);l.on('click',()=>{const c=String(f.properties.cartodb_id),d=DDATA[c];if(d)openInfo(Object.assign({c},d),'D');});}});
 labD=mkLabels(dLayer,l=>{const c=String(l.feature.properties.cartodb_id),d=DDATA[c];return d?{c:l.getBounds().getCenter(),n:d.n,code:c}:null;});
 restyle();}catch(e){warnLoad('No se pudieron cargar los distritos de Madrid.');}}
async function loadBar(){try{const r=await fetch(GEO_BAR);const gj=await r.json();
 bLayer=L.geoJSON(gj,{style:styleBar,onEachFeature:(f,l)=>{l.bindTooltip(()=>tipBar(f),{className:'mt',sticky:true});l.on('mouseover',()=>{if(simSet||selCode)return;l.setStyle({color:'#fff',weight:2.4});l.bringToFront();});l.on('mouseout',resetStyles);l.on('click',()=>{const c=String(f.properties.COD_DISBAR),d=BDATA[c];if(d)openInfo(Object.assign({c},d),'B');});}});
 labB=mkLabels(bLayer,l=>{const c=String(l.feature.properties.COD_DISBAR),d=BDATA[c];return d?{c:l.getBounds().getCenter(),n:d.n,code:c}:null;});
 restyle();}catch(e){warnLoad('No se pudieron cargar los barrios de Madrid.');}}
map.on('zoomend',restyle);
map.on('moveend',writeState);
// ---------- metric switching ----------
function setMetric(m){if(!VALID_METRICS.has(m))return;METRIC=m;
 ['pob','pre','ren','esf','ten'].forEach(x=>{const button=document.getElementById('t'+x),active=x===m;button.classList.toggle('on',active);button.setAttribute('aria-pressed',String(active));});
 document.getElementById('mdesc').innerHTML=MDESC[m];
 document.getElementById('segpob').style.display=(m==='pob')?'flex':'none';
 if(selCode){const arr=arrOf(selType);const it=arr.find(x=>x.c===selCode);simSet=null;if(it)openInfo(it,selType);}
 if(compareItems.length)renderCompare(false);writeState();restyle();}
document.querySelectorAll('[data-metric]').forEach(button=>button.addEventListener('click',()=>setMetric(button.dataset.metric)));
document.getElementById('bAbs').onclick=()=>{metric='abs';sw();};
document.getElementById('bPct').onclick=()=>{metric='pct';sw();};
function sw(){const abs=metric==='abs';document.getElementById('bAbs').classList.toggle('on',abs);document.getElementById('bAbs').setAttribute('aria-pressed',String(abs));document.getElementById('bPct').classList.toggle('on',!abs);document.getElementById('bPct').setAttribute('aria-pressed',String(!abs));if(selCode){const arr=arrOf(selType);const it=arr.find(x=>x.c===selCode);if(it)openInfo(it,selType);}if(compareItems.length)renderCompare(false);writeState();restyle();}
const SEARCH_LABEL={M:'municipio',D:'distrito',B:'barrio'};
const SEARCH_ENTRIES=[...MARR.map(item=>({item,lt:'M'})),...DARR.map(item=>({item,lt:'D'})),...BARR.map(item=>({item,lt:'B'}))].map(entry=>({...entry,label:`${entry.item.n} — ${SEARCH_LABEL[entry.lt]}`}));
const normalizeSearch=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').trim();
const zoneOptions=document.getElementById('zoneOptions');
SEARCH_ENTRIES.forEach(entry=>{const option=document.createElement('option');option.value=entry.label;zoneOptions.append(option);});
async function runSearch(){
 const input=document.getElementById('zoneSearch'),needle=normalizeSearch(input.value);
 if(!needle)return;
 const entry=SEARCH_ENTRIES.find(candidate=>normalizeSearch(candidate.label)===needle)||SEARCH_ENTRIES.find(candidate=>normalizeSearch(candidate.item.n).startsWith(needle));
 if(!entry){document.getElementById('shareStatus').textContent='Zona no encontrada.';return;}
 input.value=entry.label;await focusZone(entry.lt,entry.item.c);
}
document.getElementById('zoneSearch').addEventListener('change',runSearch);
document.getElementById('zoneSearch').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();runSearch();}});
const changesButton=document.getElementById('toggleChanges');
function syncChangesButton(){changesButton.classList.toggle('on',showChanges);changesButton.setAttribute('aria-pressed',String(showChanges));}
changesButton.addEventListener('click',()=>{showChanges=!showChanges;syncChangesButton();if(selCode){const item=itemFor(selType,selCode);if(item)openInfo(item,selType);}writeState();});
document.getElementById('info').addEventListener('click',event=>{
 const action=event.target.closest('[data-action]')?.dataset.action;
 if(action==='clear-selection')clearSel();
 else if(action==='add-compare')addCompare();
 else if(action==='show-similar')showSim();
 else if(action==='hide-similar')hideSim();
});
document.getElementById('compareBody').addEventListener('click',event=>{
 const remove=event.target.closest('[data-remove-compare]');
 if(remove){compareItems.splice(Number(remove.dataset.removeCompare),1);renderCompare();return;}
 if(event.target.closest('[data-clear-compare]')){compareItems=[];renderCompare();}
 const exportButton=event.target.closest('[data-export]');if(exportButton)exportComparison(exportButton.dataset.export);
});
document.getElementById('closeCompare').addEventListener('click',()=>{document.getElementById('compare').style.display='none';});
document.getElementById('share').addEventListener('click',async()=>{
 writeState();const status=document.getElementById('shareStatus');
 try{
  if(navigator.clipboard)await navigator.clipboard.writeText(location.href);
  else{const area=document.createElement('textarea');area.value=location.href;area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();document.execCommand('copy');area.remove();}
  status.textContent='Enlace copiado';
 }catch(error){status.textContent='No se pudo copiar; copia la URL del navegador.';}
 setTimeout(()=>{status.textContent='';},3500);
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(document.getElementById('info').style.display==='block')clearSel();else document.getElementById('compare').style.display='none';}});
// ---------- legend ----------
let lg;
function grad(arr){return 'linear-gradient(to right,'+[0,0.2,0.4,0.6,0.8,1].map(t=>_rampArr(arr,t)).join(',')+')';}
function legend(){if(lg)lg.remove();lg=L.control({position:'bottomright'});
 lg.onAdd=function(){const div=L.DomUtil.create('div','legend');let html='';
 if(METRIC==='pob'){
  const g='linear-gradient(to right,rgb(5,48,97),rgb(67,147,195),rgb(247,247,247),rgb(244,165,130),rgb(178,24,43),rgb(103,0,31))';
  const zona=level()==='zona';
  let hi,lo;
  if(zona){const vals=Object.values(ZAGG).map(z=>metric==='abs'?z.a:z.p);hi=Math.max(...vals);lo=Math.min(...vals,metric==='abs'?-1:-0.1);}
  else{const b=bnds(metric==='abs'?'poba':'pobp',GET[metric==='abs'?'poba':'pobp']);hi=b[1];lo=Math.min(b[0],metric==='abs'?-1:-0.1);}
  const fk=v=>Math.abs(v)>=1000?(Math.round(v/100)/10).toLocaleString('es')+' mil':Math.round(v).toLocaleString('es');
  if(metric==='abs'){
   const t1=fk(hi*0.0625),t2=fk(hi*0.25),t3=fk(hi*0.5625),t4=fk(hi);
   html='<b>Δ personas '+(map.getZoom()>=Z_DIST?'municipios 20-25 · Madrid 20-24':'20-25')+'</b>'
    +'<div style="height:11px;width:190px;background:'+g+';border:1px solid #888;margin:4px 0;border-radius:2px"></div>'
    +'<div style="position:relative;width:190px;height:12px;color:#555;font-size:10px">'
    +'<span style="position:absolute;left:0">'+fk(lo)+'</span><span style="position:absolute;left:40%;transform:translateX(-50%)">0</span>'
    +'<span style="position:absolute;left:55%;transform:translateX(-50%)">+'+t1+'</span><span style="position:absolute;left:70%;transform:translateX(-50%)">+'+t2+'</span>'
    +'<span style="position:absolute;left:85%;transform:translateX(-50%)">+'+t3+'</span><span style="position:absolute;right:0">+'+t4+'</span></div>'
    +'<div style="color:#888;margin-top:2px">escala &radic; con marcas reales (totales muy sesgados)'+(zona?'':' · recorte p2-p98')+'</div>'
    +'<div style="color:#888">rojo=gana · azul=pierde · <span style="color:#2ea043">verde=similar</span></div>';
  } else {
   html='<b>Δ % población '+(map.getZoom()>=Z_DIST?'municipios 20-25 · Madrid 20-24':'20-25')+'</b>'
    +'<div style="height:11px;width:190px;background:'+g+';border:1px solid #888;margin:4px 0;border-radius:2px"></div>'
    +'<div style="position:relative;width:190px;height:12px;color:#555;font-size:10px">'
    +'<span style="position:absolute;left:0">'+lo.toFixed(1)+'%</span><span style="position:absolute;left:40%;transform:translateX(-50%)">0</span>'
    +'<span style="position:absolute;left:70%;transform:translateX(-50%)">+'+(hi/2).toFixed(1)+'%</span><span style="position:absolute;right:0">+'+hi.toFixed(1)+'%</span></div>'
    +'<div style="color:#888;margin-top:2px">escala lineal'+(zona?'':' · recorte p2-p98 (extremos saturan)')+'</div>'
    +'<div style="color:#888">rojo=gana · azul=pierde · <span style="color:#2ea043">verde=similar</span></div>';
  }
 } else if(METRIC==='ten'){
  html='<b>Demanda-precio</b>'
   +'<div style="margin-top:4px"><span style="background:#d73027;width:11px;height:11px;display:inline-block;border-radius:2px"></span> Caliente (dem↑ prec↑)</div>'
   +'<div><span style="background:#fc8d59;width:11px;height:11px;display:inline-block;border-radius:2px"></span> Precio↑ sin demanda</div>'
   +'<div><span style="background:#2ea043;width:11px;height:11px;display:inline-block;border-radius:2px"></span> Recorrido (dem↑ prec rezagado)</div>'
   +'<div><span style="background:#4575b4;width:11px;height:11px;display:inline-block;border-radius:2px"></span> Frío / estable</div>'
   +'<div><span style="background:#3a3a3a;width:11px;height:11px;display:inline-block;border-radius:2px"></span> fuera del análisis</div>';
 } else {
  const cfg={pre:{t:'Precio venta €/m²',a:_YOR},ren:{t:'Rentabilidad bruta alquiler',a:_GRN},esf:{t:'Esfuerzo (años de renta, 80 m²)',a:_PUR}}[METRIC];
  const rng=bnds(METRIC,GET[METRIC]);
  const fmt=x=>METRIC==='ren'?x.toFixed(1)+'%':(METRIC==='esf'?x.toFixed(1)+' años':Math.round(x).toLocaleString('es'));
  const mid=(rng[0]+rng[1])/2;
  html='<b>'+cfg.t+'</b>'
   +'<div style="height:11px;width:190px;background:'+grad(cfg.a)+';border:1px solid #888;margin:4px 0;border-radius:2px"></div>'
   +'<div style="display:flex;justify-content:space-between;width:190px;color:#555"><span>'+fmt(rng[0])+'</span><span>'+fmt(mid)+'</span><span>'+fmt(rng[1])+'</span></div>'
   +'<div style="color:#888;margin-top:2px">escala lineal · recorte p2-p98 (extremos saturan) · misma escala en los 3 niveles</div>'
   +'<div style="color:#888">gris = sin dato · <span style="color:#2ea043">verde=similar</span></div>';
 }
 div.innerHTML=html; return div;};
 lg.addTo(map);}

const initialCompare=(query.get('compare')||'').split(',').map(decodeRef).filter(Boolean);
for(const reference of initialCompare){
 const item=itemFor(reference.lt,reference.code);
 if(item&&compareItems.length<2)compareItems.push({item,lt:reference.lt});
}
const initialZone=decodeRef(query.get('zone'));
syncChangesButton();setMetric(METRIC);sw();
if(compareItems.length)renderCompare();
if(initialZone){const item=itemFor(initialZone.lt,initialZone.code);if(item)openInfo(item,initialZone.lt);}
geometryReady=Promise.all([loadMuni(),loadDist(),loadBar()]);
geometryReady.then(([municipalitiesLoaded])=>{if(municipalitiesLoaded)document.getElementById('load').style.display='none';});
