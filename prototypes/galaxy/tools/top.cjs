const fs=require('fs');const d=process.argv[2];
const p=JSON.parse(fs.readFileSync(d+'/'+fs.readdirSync(d)[0]));
const self={};const byId={};for(const n of p.nodes)byId[n.id]=n;
const dt=p.timeDeltas;
const lines={};
for(let i=0;i<p.samples.length;i++){const n=byId[p.samples[i]];const k=n.callFrame.functionName+':'+n.callFrame.lineNumber;self[k]=(self[k]||0)+(dt[i]||0);
 if(n.positionTicks){}}
Object.entries(self).sort((a,b)=>b[1]-a[1]).slice(0,14).forEach(([k,v])=>console.log((v/1000).toFixed(0).padStart(6),'ms',k));
// line-level for top function
for (const n of p.nodes) if (n.positionTicks && n.callFrame.functionName===process.argv[3]) { const t=n.positionTicks.sort((a,b)=>b.ticks-a.ticks).slice(0,12); console.log(JSON.stringify(t)); }
