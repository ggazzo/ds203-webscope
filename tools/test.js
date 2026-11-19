// node test.js : extracts the PURE block from index.html and tests it
const fs=require("fs"),vm=require("vm"),assert=require("assert");
const html=fs.readFileSync(__dirname+"/../docs/index.html","utf8");
const code=html.split("// ==PURE-BEGIN==")[1].split("// ==PURE-END==")[0];
const ctx={setTimeout,clearTimeout,Date,Math,Uint8Array,Float32Array,Float64Array,String,Number,Error,JSON,RegExp};
vm.createContext(ctx);
vm.runInContext(code+";this.X={ByteQueue,DeviceError,parseCapHeader,readCapFrame,deinterleave,parseKV,parseTables,fmtSI,measure,fft,spectrum,TB_SECONDS}",ctx);
const X=ctx.X;
const tests=[];const t=(n,f)=>tests.push([n,f]);
const frameBytes=(n,bps,fn)=>{
  const hdr=Buffer.from(`#CAP ${n} ${bps}\n`),d=Buffer.alloc(n*bps);
  for(let i=0;i<n;i++)for(let c=0;c<bps;c++)d[i*bps+c]=fn(i,c);
  return Buffer.concat([hdr,d,Buffer.from("\nOK\n")]);
};
async function feed(q,buf,chunk){for(let i=0;i<buf.length;i+=chunk){q.push(new Uint8Array(buf.slice(i,i+chunk)));await new Promise(r=>setTimeout(r,0))}}

t("header parse",()=>{assert.deepStrictEqual({...X.parseCapHeader("#CAP 4096 2")},{n:4096,bps:2});assert.strictEqual(X.parseCapHeader("ERR timeout"),null);assert.strictEqual(X.parseCapHeader("#CAP 10 5"),null)});
t("frame parse chunked, binary contains \\n and 0x80+",async()=>{
  const q=new X.ByteQueue(),n=300;
  const buf=frameBytes(n,2,(i,c)=>c?(i*7)&255:(i===5?10:i&255)); // byte value 10 inside payload
  const p=X.readCapFrame(q);await feed(q,buf,37);const f=await p;
  assert.strictEqual(f.n,n);assert.strictEqual(f.a[5],10);assert.strictEqual(f.b[200],(200*7)&255);assert.strictEqual(f.d,null);
});
t("CAPD 3 bytes",async()=>{
  const q=new X.ByteQueue();const p=X.readCapFrame(q);await feed(q,frameBytes(8,3,(i,c)=>i+c*10),64);
  const f=await p;assert.strictEqual(f.d[3],23);assert.strictEqual(f.b[3],13);
});
t("ERR reply -> DeviceError",async()=>{
  const q=new X.ByteQueue();q.push(new Uint8Array(Buffer.from("ERR timeout\r\n")));
  await assert.rejects(X.readCapFrame(q),e=>e instanceof X.DeviceError&&e.message==="ERR timeout");
});
t("short payload times out",async()=>{
  const q=new X.ByteQueue();q.push(new Uint8Array(Buffer.from("#CAP 100 2\n")));q.push(new Uint8Array(50));
  const orig=Date.now;let base=orig();Date.now=()=>base+=3000; // fast-forward clock
  try{await assert.rejects(X.readCapFrame(q),/timed out after 50 of 200/)}finally{Date.now=orig}
});
t("bad trailer",async()=>{
  const q=new X.ByteQueue();const b=frameBytes(4,2,()=>1);b[b.length-1]=0x58;q.push(new Uint8Array(b));
  await assert.rejects(X.readCapFrame(q),/bad frame trailer/);
});
t("kv/tables/si",()=>{
  const s=X.parseKV("STATE RA=5 RB=1 OA=150 MODE=0 N=4096");assert.strictEqual(s.RA,5);assert.strictEqual(s.MODE,0);assert.strictEqual(s.N,4096);
  const tb=X.parseTables("TABLES V=10mV 20mV 50mV T=1s 500ms");assert.deepStrictEqual([...tb.V],["10mV","20mV","50mV"]);assert.strictEqual(tb.T.length,2);
  assert.strictEqual(X.fmtSI(1500,"Hz"),"1.50 kHz");assert.strictEqual(X.fmtSI(2e-6,"s"),"2.00 us");assert.strictEqual(X.fmtSI(NaN,"s"),"-");
});
t("measure square 25% duty",()=>{
  const n=4096,per=256,x=new Uint8Array(n);
  for(let i=0;i<n;i++)x[i]=(i%per)<64?200:50;
  const m=X.measure(x,1e-6);
  assert.strictEqual(m.min,50);assert.strictEqual(m.max,200);assert.strictEqual(m.vpp,150);
  assert(Math.abs(m.period-256e-6)<1e-9,"period "+m.period);assert(Math.abs(m.freq-1/256e-6)<1);
  assert(Math.abs(m.duty-0.25)<0.01,"duty "+m.duty);
});
t("measure noisy sine freq + rms",()=>{
  const n=4096,x=new Uint8Array(n);let seed=1;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647-.5;
  for(let i=0;i<n;i++)x[i]=Math.round(128+80*Math.sin(2*Math.PI*i/100)+rnd()*6);
  const m=X.measure(x,1e-6);
  assert(Math.abs(m.period-100e-6)<1e-6,"period "+m.period);assert(Math.abs(m.rms-Math.sqrt(128*128+80*80/2))<2);
  assert(Math.abs(m.duty-0.5)<0.03);
});
t("measure flat line -> no freq",()=>{const m=X.measure(new Uint8Array(100).fill(90),1e-6);assert.strictEqual(m.freq,null);assert.strictEqual(m.vpp,0)});
t("fft/spectrum sine peak",()=>{
  const n=4096,x=new Uint8Array(n);
  for(let i=0;i<n;i++)x[i]=Math.round(128+100*Math.sin(2*Math.PI*64*i/n));
  const s=X.spectrum(x,4096e3);let pk=1;for(let k=1;k<s.db.length;k++)if(s.db[k]>s.db[pk])pk=k;
  assert.strictEqual(pk,64);assert(Math.abs(s.df-1000)<1e-9);
  const exp=20*Math.log10(100/127.5);assert(Math.abs(s.db[64]-exp)<0.3,`${s.db[64]} vs ${exp}`);
  assert(s.db[300]<-60);
});
t("fft matches naive DFT",()=>{
  const n=16,re=new Float64Array(n),im=new Float64Array(n),x=[];
  for(let i=0;i<n;i++){x.push(Math.sin(i*1.3)+i%3);re[i]=x[i]}
  X.fft(re,im);
  for(let k=0;k<n;k++){let r=0,m=0;for(let i=0;i<n;i++){r+=x[i]*Math.cos(2*Math.PI*k*i/n);m-=x[i]*Math.sin(2*Math.PI*k*i/n)}
    assert(Math.abs(r-re[k])<1e-9&&Math.abs(m-im[k])<1e-9)}
});

(async()=>{let f=0;for(const [n,fn] of tests){try{await fn();console.log("ok  ",n)}catch(e){f++;console.log("FAIL",n,"-",e.message)}}
  console.log(f?`${f} failed`:"all passed");process.exit(f?1:0)})();
