import json, numpy as np
R = json.load(open('bench_results.json'))
rows = []
for r in R:
    a = r['app']; t = r['t']
    if 'error' in r: rows.append(dict(p=r['preset'], id=r['id'], t=t, err=r['error'], conv=r['conv'])); continue
    def agg(tag):
        cs = r['runs'][tag]['cases']; vm = max(c['vmAway'] for c in cs.values()); df = max(c['defl'] for c in cs.values())
        lam = min((c['lam'] for c in cs.values() if 'lam' in c), default=np.nan); return vm, df, lam
    vmF, dF, lF = agg('fine'); vmC, dC, lC = agg('coarse')
    d05 = agg('fine_p05')[1]; d2 = agg('fine_p2')[1]
    rows.append(dict(p=r['preset'], id=r['id'], t=t, conv=r['conv'], pas=a['pass'], gov=a['gov'],
        s_size=a['sig'], s_app=a['fin'], s_ind=vmF, s_r=vmF / a['fin'], s_rc=vmC / a['fin'], s_margin=a['sig'] / vmF,
        d_app=a['defl'], d_ind=dF, d_r=dF / a['defl'], d_lo=d05 / a['defl'], d_hi=d2 / a['defl'],
        l_app=a['blf'], l_ind=lF, l_r=lF / a['blf'], l_rc=lC / a['blf'], nel=r['runs']['fine']['nel'],
        eq=max(abs(c['react'][0] + c['sumF'][0]) + abs(c['react'][1] + c['sumF'][1]) for c in r['runs']['fine']['cases'].values())))
json.dump(rows, open('bench_table.json', 'w'), indent=1)
use = [x for x in rows if 'err' not in x and x['conv'] and x['t'] <= 30]
print(f"{'case':<11}{'t':>5} {'gov':<22}{'σ app':>7}{'σ ind':>7}{'ratio':>7}{'sizing/ind':>11} |{'δ app':>7}{'δ ind':>7}{'ratio':>7} [{'p.5':>5},{'p2':>5}] |{'λ app':>8}{'λ ind':>8}{'ratio':>7}")
for x in rows:
    if 'err' in x: print(x['p'], x['id'], 'ERROR', x['err']); continue
    flag = '' if (x['conv'] and x['t'] <= 30) else '  (not used: ' + ('not converged' if not x['conv'] else 't>30') + ')'
    print(f"{x['p']+' '+x['id']:<11}{x['t']:>5g} {x['gov'][:21]:<22}{x['s_app']:>7.1f}{x['s_ind']:>7.1f}{x['s_r']:>7.3f}{x['s_margin']:>11.3f} |{x['d_app']:>7.3f}{x['d_ind']:>7.3f}{x['d_r']:>7.3f} [{x['d_lo']:>5.3f},{x['d_hi']:>5.3f}] |{x['l_app']:>8.2f}{x['l_ind']:>8.2f}{x['l_r']:>7.3f}{flag}")
print()
for k, lab, tol in (('s_r', 'peak stress (finest mesh)', .10), ('d_r', 'deflection', .05), ('l_r', 'buckling factor', .05)):
    v = np.array([x[k] for x in use])
    print(f"{lab:<16} n={len(v)}  mean ratio {v.mean():.3f}  min {v.min():.3f}  max {v.max():.3f}  within ±{tol:.0%}: {int((abs(v - 1) <= tol).sum())}/{len(v)}")
print('max reaction imbalance (N):', max(x['eq'] for x in rows if 'eq' in x))

v = np.array([x['s_margin'] for x in use])
print(f"sizing stress / independent stress: min {v.min():.3f}  mean {v.mean():.3f}  max {v.max():.3f}  (>=0.95, i.e. never meaningfully under-predicting: {int((v >= 0.95).sum())}/{len(v)})")
print(f"designs excluded: {len(rows) - len(use)} ({sum(1 for x in rows if 'err' not in x and not x['conv'])} not converged by the app's own mesh check, {sum(1 for x in rows if 'err' not in x and x['conv'] and x['t'] > 30)} with t > 30 mm)")
