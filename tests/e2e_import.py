import asyncio, json
from playwright.async_api import async_playwright
from shapely.geometry import Polygon
from shapely.ops import unary_union
import os
CHROME=os.environ.get('CHROME','/usr/bin/google-chrome')
URL='file://'+os.path.abspath(os.path.join(os.path.dirname(__file__),'..','index.html'))
DONE="(()=>{const t=document.getElementById('verdict').textContent;return t.startsWith('Recommended')||t.startsWith('No design')})()"
fails=[]
def ok(c,msg):
    print(('PASS ' if c else 'FAIL ')+msg)
    if not c: fails.append(msg)
def pair(c,v): return f"{c}\n{v}\n"
def dxf(ents,units=4):
    return pair(0,'SECTION')+pair(2,'HEADER')+pair(9,'$INSUNITS')+pair(70,units)+pair(0,'ENDSEC')+pair(0,'SECTION')+pair(2,'ENTITIES')+ents+pair(0,'ENDSEC')+pair(0,'EOF')
def lw(pts):
    s=pair(0,'LWPOLYLINE')+pair(8,'0')+pair(90,len(pts))+pair(70,1)
    for x,y in pts: s+=pair(10,x)+pair(20,y)
    return s
def circ(cx,cy,r): return pair(0,'CIRCLE')+pair(8,'0')+pair(10,cx)+pair(20,cy)+pair(40,r)
LPTS=[(0,0),(120,0),(120,30),(30,30),(30,80),(0,80)]
IMP=Polygon(LPTS).difference(Polygon([(75+8*__import__('math').cos(t*6.2831853/64),15+8*__import__('math').sin(t*6.2831853/64)) for t in range(64)]))
async def main():
    async with async_playwright() as p:
        br=await p.chromium.launch(executable_path=CHROME,args=['--no-sandbox'])
        ctx=await br.new_context(viewport={'width':1360,'height':1000})
        pg=await ctx.new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_function(DONE,timeout=300000)
        text=dxf(lw(LPTS)+circ(75,15,8))
        await pg.set_input_files('#impFile',files=[{'name':'lbracket.dxf','mimeType':'application/dxf','buffer':text.encode()}]); await pg.wait_for_timeout(500)
        st=await pg.evaluate("({W:S.W,H:S.H,n:S.outline&&S.outline.loops.length,f:S.features.length,info:document.getElementById('impInfo').textContent})")
        ok(st['n']==2 and abs(st['W']-120)<1e-6 and abs(st['H']-80)<1e-6, f"DXF import: 2 loops, design space {st['W']} x {st['H']} mm")
        # unsupported/failed files
        await pg.set_input_files('#impFile',files=[{'name':'bad.dxf','mimeType':'application/dxf','buffer':b'junk\n'}]); await pg.wait_for_timeout(300)
        ok((await pg.evaluate("document.getElementById('banner').className")).find('err')>=0 and (await pg.evaluate("S.outline.loops.length"))==2,'bad file: error shown, previous outline kept')
        await pg.evaluate("""(()=>{S.features=[{type:'fix',dof:'xy',x0:0,y0:45,x1:0,y1:80},{type:'load',x:118,y:15,fx:0,fy:-400}];S.res='std';syncInputs();markDirty();})()""")
        await pg.click('#go'); await pg.wait_for_timeout(300); await pg.wait_for_function(DONE,timeout=300000)
        await pg.wait_for_function("(()=>S.verify && S.verify.done===S.verify.total)()",timeout=900000)
        res={}
        for rc in (0,4):
            res[rc]=await pg.evaluate("""(rc)=>{S.rc=rc;S.geoKey++;const out={};for(const id of ['B','C','D']){const R=S.results[id];if(!R||!R.ev)continue;
              const lp=withoutHoleLoops(contours(R));const m=metrics(R);out[id]={loops:lp.map(l=>l.map(([x,y])=>[x,y])),area:m.area,sig:m.sig}}
              return out}""",rc)
        ok(len(res[0])>=2,'imported-outline run produced designs')
        for rc in (0,4):
            for id,r in res[rc].items():
                polys=[Polygon(l) for l in r['loops'] if len(l)>=3]
                if not polys: ok(False,f'rc={rc} {id}: no outline'); continue
                outer=max(polys,key=lambda q:q.area)
                body=unary_union([q for q in polys if q.area>=1e-6])
                hi=IMP.buffer(0.35)   # outline sits inside the imported plate within the marching-squares tolerance
                ok(outer.difference(hi).area<0.5, f"rc={rc} {id}: designed outline stays inside the imported plate (excess {outer.difference(hi).area:.3f} mm2)")
        # radius: the complement of the part must contain no feature smaller than rc: part is unchanged by morphological closing
        for id,r in res[4].items():
            outer=max([Polygon(l) for l in r['loops'] if len(l)>=3],key=lambda q:q.area)
            closed=outer.buffer(3.0,resolution=32).buffer(-3.0,resolution=32)
            ok(closed.difference(outer).area<=0.01*outer.area+2.0, f"rc=4 {id}: closing with r=3 mm adds only {closed.difference(outer).area:.2f} mm2 (min inner radius honoured)")
        # without rc the sharp inner corner of the L usually stays sharper: area added by closing at r=3
        a0=sum(res[0][i]['area'] for i in res[0]); a4=sum(res[4][i]['area'] for i in res[4])
        ok(a4>=a0-1e-6, f"radius never removes material: area {a0:.0f} -> {a4:.0f} mm2")
        # persistence
        pj=await pg.evaluate("projectJSON()"); o=json.loads(pj)
        ok(o['outline'] and len(o['outline']['loops'])==2 and o['minInnerRadius']==4,'project file carries outline and min radius')
        await pg.evaluate("S.outline=null;S.rc=0;S.features=[]")
        await pg.set_input_files('#projFile',files=[{'name':'p.json','mimeType':'application/json','buffer':pj.encode()}]); await pg.wait_for_timeout(400)
        ok(await pg.evaluate("S.outline&&S.outline.loops.length===2&&S.rc===4&&S.features.length===2"),'project reload restores outline, radius, features')
        # SVG with mm size and y flip
        svg='<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60"><path d="M0 0 L100 0 L100 60 L0 60 Z"/><circle cx="50" cy="30" r="10"/></svg>'
        await pg.set_input_files('#impFile',files=[{'name':'r.svg','mimeType':'image/svg+xml','buffer':svg.encode()}]); await pg.wait_for_timeout(400)
        s2=await pg.evaluate("({W:S.W,H:S.H,n:S.outline.loops.length})"); ok(s2['n']==2 and abs(s2['W']-100)<1e-6 and abs(s2['H']-60)<1e-6,f"SVG import in mm: {s2}")
        # inch DXF scaled
        t2=dxf(lw([(0,0),(4,0),(4,3),(0,3)]),units=1)
        await pg.set_input_files('#impFile',files=[{'name':'in.dxf','mimeType':'application/dxf','buffer':t2.encode()}]); await pg.wait_for_timeout(400)
        s3=await pg.evaluate("({W:S.W,H:S.H})"); ok(abs(s3['W']-101.6)<1e-6 and abs(s3['H']-76.2)<1e-6,f"DXF in inches scaled to mm: {s3}")
        # outside-outline feature warning
        await pg.evaluate("S.features=[{type:'fix',dof:'xy',x0:0,y0:0,x1:0,y1:20},{type:'load',x:2000,y:5,fx:0,fy:-1}];")
        ok(errs==[],'no page errors '+str(errs))
        await br.close()
    print('\n%d failures'%len(fails)); raise SystemExit(1 if fails else 0)
asyncio.run(main())
