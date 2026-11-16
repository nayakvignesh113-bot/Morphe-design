import asyncio, os, math
from playwright.async_api import async_playwright
CHROME=os.environ.get('CHROME','/usr/bin/google-chrome')
URL='file://'+os.path.abspath(os.path.join(os.path.dirname(__file__),'..','index.html'))
DONE="(()=>{const t=document.getElementById('verdict').textContent;return t.startsWith('Recommended')||t.startsWith('No design')})()"
fails=[]
def ok(c,m):
    print(('PASS ' if c else 'FAIL ')+m)
    if not c: fails.append(m)
async def main():
    async with async_playwright() as p:
        br=await p.chromium.launch(executable_path=CHROME,args=['--no-sandbox'])
        pg=await (await br.new_context(viewport={'width':1360,'height':1000})).new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_function(DONE,timeout=300000)
        await pg.click('#linkBtn'); await pg.wait_for_timeout(200)
        ok(await pg.evaluate("document.getElementById('linkDlg').open"),'linkage dialog opens')
        txt=await pg.inner_text('#lkOut')
        ok('Arm crowd at relief' in txt and 'tip force 120.1' in txt and '502.4' in txt.replace(',','') , 'crowd case shows tip force 120.1 kN and 502.4 kN stick pin')
        await pg.select_option('#lkMode','breakout'); await pg.click('#lkSolve'); txt=await pg.inner_text('#lkOut')
        ok('tip force 128.0' in txt and '543.7' in txt,'breakout case shows 128.0 kN tip and 543.7 kN link')
        await pg.select_option('#lkMode','lift'); await pg.fill('#lkTh1','20'); await pg.fill('#lkThS','-15'); await pg.fill('#lkLoad','37.6'); await pg.click('#lkSolve'); txt=await pg.inner_text('#lkOut')
        ok('911.2' in txt and '884.7' in txt,'lift case shows 911.2 kN boom cylinder and 884.7 kN foot pin')
        await pg.fill('#lkThB','60'); await pg.click('#lkSolve'); txt=await pg.inner_text('#lkOut')
        ok('cannot reach' in txt or 'outside' in txt,'out-of-range bucket angle gives a clear message')
        await pg.fill('#lkThB','-100'); await pg.click('#lkSolve')
        # use the stick-boom pin force on the stick as the load tool setting
        n=await pg.evaluate("[...document.querySelectorAll('#lkOut button')].length"); ok(n>=6,f'load buttons present ({n})')
        await pg.evaluate("[...document.querySelectorAll('#lkOut tr')].find(r=>r.textContent.startsWith('Pin: stick-boom pin')).querySelector('button').click()"); await pg.wait_for_timeout(150)
        st=await pg.evaluate("({m:S.loadMag,a:S.loadAng,open:document.getElementById('linkDlg').open})")
        ok(not st['open'] and abs(st['m']-170300)<600 and 0<=st['a']<360,f"'use as load' sets the load tool ({st['m']} N at {st['a']} deg) and closes")
        await pg.click('#linkBtn'); await pg.click('#linkDlg summary'); await pg.click('#lkExample'); await pg.click('#lkSolveJson'); txt=await pg.inner_text('#lkOut')
        ok('rod' in txt and '5.0' in txt,'JSON example solves (rod 5.0)')
        await pg.fill('#lkJson','{bad'); await pg.click('#lkSolveJson'); txt=await pg.inner_text('#lkOut'); ok(len(txt)>0 and 'rod' not in txt,'bad JSON gives a message, not a crash')
        ok(errs==[],'no page errors '+str(errs)); await br.close()
    print('\n%d failures'%len(fails)); raise SystemExit(1 if fails else 0)
asyncio.run(main())
