import json, sys, time, numpy as np
from multiprocessing import Pool
from indep import run_design
D = json.load(open('designs.json'))
jobs = [(p, i) for p, v in D.items() for i in range(len(v))]
def one(job):
    p, i = job; d = D[p][i]; t0 = time.time()
    num = [l for l in d['app']['lvl'] if l != 'opt']; hF = d['h'] / max(num)
    r = {'preset': p, 'id': d['id'], 't': d['t'], 'conv': d['conv'], 'app': d['app'], 'hF': hF, 'runs': {}}
    try:
        for tag, size, patch, bk in (('coarse', 2.0 * hF, 1.0, True), ('fine', 1.0 * hF, 1.0, True), ('fine_p05', 1.0 * hF, 0.5, False), ('fine_p2', 1.0 * hF, 2.0, False)):
            o = run_design(d, size, hF, patch=patch, buckling=bk)
            r['runs'][tag] = {'nel': o['nel'], 'cases': {str(k): c for k, c in o['cases'].items()}}
    except Exception as ex:
        r['error'] = repr(ex)
    r['sec'] = time.time() - t0
    print(p, d['id'], 'done %.0fs' % r['sec'], r.get('error', ''), flush=True)
    return r
if __name__ == '__main__':
    with Pool(max(1, min(4, __import__('os').cpu_count() - 1))) as pool:
        out = pool.map(one, jobs, chunksize=1)
    json.dump(out, open('bench_results.json', 'w'))
