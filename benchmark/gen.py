import asyncio, json, sys
from playwright.async_api import async_playwright
import os
HERE=os.path.dirname(os.path.abspath(__file__))
URL='file://'+os.path.join(HERE,'..','index.html')
DONE="(()=>{const t=document.getElementById('verdict').textContent;return t.startsWith('Recommended')||t.startsWith('No design')})()"
import sys
PRESETS=sys.argv[1].split(',')
OUT=sys.argv[2]
JS="""(()=>{const d=S.lastDisc,out=[];
 for(const id of Object.keys(S.results)){const R=S.results[id];if(id==='base'||!R.ev)continue;const m=metrics(R);if(!m||!m.ver)continue;
  const lp=withoutHoleLoops(contours(R));
  out.push({id,t:m.t,conv:m.converged,mat:MATERIALS[S.mat],h:d.h,exclR:EXCL*d.h,W:d.W,H:d.H,
   outline:lp,holes:(d.holes||[]).map(H=>({x:H.f.x,y:H.f.y,r:H.rh,role:H.f.role,fx:H.f.fx||0,fy:H.f.fy||0,lc:H.f.lc||1})),
   features:S.features,caseIds:d.caseIds,
   app:{sig:m.sig,fos:m.fos,defl:m.defl,blf:m.blf,stiff:m.stiff,mass:m.mass,gov:m.governs,pass:m.pass,vmAway:m.src.vmAway,xy:m.src.xy,dLoad:m.src.dLoad,lamB:m.src.lamB,lvl:m.ver.levels.map(l=>l.r),ex:m.as.extrapPct,fin:m.as.finest/m.t,lv:m.ver.levels.map(l=>({r:l.r,vm:l.vmAway/m.t,dl:l.dLoad/(MATERIALS[S.mat].E*m.t),lam:l.lamB*MATERIALS[S.mat].E*m.t*m.t*m.t,bk:l.bk}))}});}
 return out})()"""
async def main():
    res={}
    async with async_playwright() as p:
        br=await p.chromium.launch(executable_path=os.environ.get('CHROME','/usr/bin/google-chrome'),args=['--no-sandbox'])
        pg=await (await br.new_context(viewport={'width':1360,'height':1000})).new_page()
        await pg.goto(URL); await pg.evaluate("localStorage.clear()"); await pg.reload()
        for k in PRESETS:
            await pg.evaluate(f"applyPreset('{k}',true)")
            await pg.evaluate("document.getElementById('go').click()")
            await pg.wait_for_function(DONE,timeout=600000)
            await pg.wait_for_function("(()=>S.verify && S.verify.done===S.verify.total)()",timeout=900000)
            res[k]=await pg.evaluate(JS); print(k,len(res[k]),'designs',flush=True)
        await br.close()
    json.dump(res,open(OUT,'w'))
asyncio.run(main())
