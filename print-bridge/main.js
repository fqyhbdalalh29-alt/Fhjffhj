const { app, BrowserWindow } = require('electron');
const http = require('http');
const { SerialPort } = require('serialport');

let server;
let printWindow;
const PORT = 3210;

function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network','true');
}
function json(res, code, data){ cors(res); res.writeHead(code, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(data)); }
function body(req){ return new Promise((resolve,reject)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{try{resolve(JSON.parse(b||'{}'))}catch(e){reject(e)}});req.on('error',reject)}) }
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function receipt(o, settings, kitchen=false){
  const width = settings.width==='58' ? '48mm':'72mm';
  const shop=esc(settings.shop||'بوفية توب كبدة');
  const lines=(o.i||[]).map(x=>`<div class="line"><b>${esc(x[1])}×</b><span>${esc(x[0])}</span><b>${esc(x[1]*(parseFloat(x[2])||0))}</b></div>`).join('');
  const car=o.t==='من السيارة';
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>@page{size:${width} auto;margin:2mm}body{font-family:Arial,"Segoe UI",sans-serif;width:${width};margin:0;color:#000;font-size:12px;line-height:1.5}.c{text-align:center}.big{font-size:17px;font-weight:700}.line{display:grid;grid-template-columns:28px 1fr 45px;gap:3px;border-bottom:1px dashed #000;padding:3px 0}.line span{text-align:right}.hr{border-top:1px dashed #000;margin:5px 0}.total{font-size:18px;font-weight:700;display:flex;justify-content:space-between}.muted{font-size:11px}</style></head><body><div class="c"><b>${kitchen?'المطبخ':shop}</b><br><span class="big">طلب #${esc(o.r)}</span><br>${esc(new Date(o.ts||Date.now()).toLocaleString('ar-SA'))}</div><div class="hr"></div><div class="big">${esc(o.t||'')} · ${esc(o.w||'')}</div>${car?`<div>🚗 ${esc(o.c)} · ${esc(o.l)} · ${esc(o.p)}</div>`:''}${o.n?`<div>العميل: ${esc(o.n)}</div>`:''}<div class="hr"></div>${lines}${o.no?`<div class="hr"><b>ملاحظات:</b> ${esc(o.no)}</div>`:''}${kitchen?'':`<div class="hr"></div><div class="total"><span>الإجمالي</span><span>${esc(o.tot)} ر.س</span></div>`}<div class="hr"></div><div class="c muted">${esc(settings.foot||'')}</div></body></html>`;
}
async function printers(){
  const win = printWindow || new BrowserWindow({show:false});
  let ps=[];
  try{ ps=await win.webContents.getPrintersAsync(); }catch(e){}
  let ports=[];
  try{ports=await SerialPort.list()}catch(e){}
  return {ok:true,printers:ps.map(p=>({name:p.name,displayName:p.displayName||p.name,isDefault:!!p.isDefault,status:p.status})),ports};
}
function findPrinter(settings, kitchen, discovered){
  const role=kitchen?'kitchen':'cashier';
  const cfg=(settings.printers||[]).find(p=>p && (p.role==='both'||p.role===role) && p.n && p.n!=='طابعة جديدة');
  if(cfg){const exact=discovered.find(x=>x.name===cfg.n||x.displayName===cfg.n);if(exact)return exact.name;}
  const def=discovered.find(x=>x.isDefault); return def?def.name:null;
}
async function silentPrint(html, deviceName){
  if(!printWindow) printWindow=new BrowserWindow({show:false,webPreferences:{sandbox:true}});
  await printWindow.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
  return await new Promise((resolve,reject)=>{
    printWindow.webContents.print({silent:true,printBackground:false,deviceName:deviceName||undefined,copies:1},(success,failureReason)=>success?resolve(true):reject(new Error(failureReason||'تعذرت الطباعة')));
  });
}
async function doPrint(payload){
  const o=payload.order||{}; const settings=payload.settings||{};
  const discovered=(await printers()).printers||[];
  const targets=[];
  const add=(k)=>{const d=findPrinter(settings,k,discovered);targets.push({k,d})};
  add(false); add(true);
  const uniq=[]; for(const t of targets){const key=(t.d||'__default__')+'|'+t.k;if(!uniq.some(x=>x.d===t.d&&x.k===t.k))uniq.push(t)}
  let printed=0; const errors=[];
  for(const t of uniq){try{await silentPrint(receipt(o,settings,t.k==='k'),t.d);printed++}catch(e){errors.push((t.k==='k'?'المطبخ':'الكاشير')+': '+e.message)}}
  return {ok:printed>0,printed,errors,printers:discovered};
}
function startServer(){
 server=http.createServer(async(req,res)=>{
   cors(res);
   if(req.method==='OPTIONS'){res.writeHead(204);return res.end()}
   try{
     if(req.method==='GET'&&req.url==='/health')return json(res,200,{ok:true,service:'Top Kabda Print Bridge',port:PORT});
     if(req.method==='GET'&&req.url==='/printers')return json(res,200,await printers());
     if(req.method==='POST'&&req.url==='/print')return json(res,200,await doPrint(await body(req)));
     return json(res,404,{ok:false,error:'Not found'});
   }catch(e){return json(res,500,{ok:false,error:e.message})}
 });
 server.listen(PORT,'127.0.0.1');
}
app.whenReady().then(()=>{
  try{ app.setLoginItemSettings({openAtLogin:true}); }catch(e){}
  printWindow=new BrowserWindow({show:false});
  startServer();
});
app.on('window-all-closed',e=>e.preventDefault());
app.on('before-quit',()=>{try{server?.close()}catch(e){}});
