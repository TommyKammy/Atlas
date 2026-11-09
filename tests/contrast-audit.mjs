#!/usr/bin/env node
// Usage: node tests/contrast-audit.mjs [baseUrl]
// Requires Chrome with remote debugging at 127.0.0.1:9222 and a logged-in session.
const base = process.argv[2] ?? "http://127.0.0.1:3000";
const theme = process.argv[3] === "dark" ? "dark" : "light";
const pages = ["list", "board", "timeline", "forms", "knowledge"];

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const target = list.find((entry) => entry.type === "page" && entry.url.startsWith(base))
  ?? list.find((entry) => entry.type === "page" && entry.url.startsWith("http://127.0.0.1"));
if (!target) {
  console.error("no Chrome page target found");
  process.exit(2);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const entry = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
  else entry.resolve(message.result);
};
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const callId = ++id;
    pending.set(callId, { resolve, reject });
    ws.send(JSON.stringify({ id: callId, method, params }));
  });
const evaluate = (expression) =>
  send("Runtime.evaluate", { expression, returnByValue: true }).then((result) => result.result.value);

const AUDIT = `(() => {
  const canvas=document.createElement('canvas'); canvas.width=canvas.height=1;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const toRgba=(color)=>{ if(!color||color==='transparent') return {r:0,g:0,b:0,a:0};
    ctx.clearRect(0,0,1,1); ctx.fillStyle='rgba(0,0,0,0)'; ctx.fillStyle=color; ctx.fillRect(0,0,1,1);
    const d=ctx.getImageData(0,0,1,1).data; return {r:d[0],g:d[1],b:d[2],a:d[3]/255}; };
  const blend=(fg,bg)=>({r:fg.r*fg.a+bg.r*(1-fg.a),g:fg.g*fg.a+bg.g*(1-fg.a),b:fg.b*fg.a+bg.b*(1-fg.a),a:1});
  const lum=(c)=>{const f=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);};
  const ratio=(a,b)=>{const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);};
  const bgOf=(el)=>{let cur=el;const stack=[];while(cur){const p=toRgba(getComputedStyle(cur).backgroundColor);if(p.a>0)stack.push(p);cur=cur.parentElement;}let bg={r:255,g:255,b:255,a:1};for(let i=stack.length-1;i>=0;i--)bg=blend(stack[i],bg);return bg;};
  const visible=(el)=>{const r=el.getBoundingClientRect();const s=getComputedStyle(el);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0;};
  const seen=new Set(); const fails=[];
  for(const el of document.querySelectorAll('body *')){
    if(!visible(el)) continue;
    if(![...el.childNodes].some((n)=>n.nodeType===3&&(n.textContent||'').trim().length>0)) continue;
    const text=(el.innerText||'').trim(); if(!text) continue;
    const s=getComputedStyle(el); const fg=toRgba(s.color); if(fg.a===0) continue;
    const bg=bgOf(el); const f=fg.a<1?blend(fg,bg):fg; const size=parseFloat(s.fontSize); const weight=Number(s.fontWeight)||400;
    const threshold=(size>=18||(size>=14&&weight>=700))?3:4.5; const cr=ratio(f,bg);
    if(cr+0.01<threshold){
      const key=[Math.round(fg.r/16),Math.round(fg.g/16),Math.round(fg.b/16),Math.round(bg.r/16),Math.round(bg.g/16),Math.round(bg.b/16),Math.round(size),weight].join('|');
      if(seen.has(key)) continue; seen.add(key);
      fails.push({text:text.replace(/\\s+/g,' ').slice(0,60),cr:Math.round(cr*100)/100,fg:s.color,bg:'rgb('+Math.round(bg.r)+', '+Math.round(bg.g)+', '+Math.round(bg.b)+')'});
    }
  }
  return fails;
})()`;

let failed = 0;
for (const view of pages) {
  await send("Page.navigate", { url: `${base}/projects/1?view=${view}` });
  await new Promise((resolve) => setTimeout(resolve, 1400));
  if (theme === "dark") {
    await evaluate('document.documentElement.dataset.theme = "dark"');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const fails = await evaluate(AUDIT);
  console.log(`${view} (${theme}): ${fails.length} contrast failures`);
  if (fails.length > 0) {
    failed += fails.length;
    console.log(JSON.stringify(fails.slice(0, 10), null, 2));
  }
}
ws.close();
if (failed > 0) process.exit(1);
console.log(`contrast audit PASS (${theme})`);
