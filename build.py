"""Build the single-file app: inlines src/core.js (Web Worker) and src/app.js into index.html."""
from pathlib import Path
root = Path(__file__).parent
core, app, geom, link = (root / 'src/core.js').read_text(), (root / 'src/app.js').read_text(), (root / 'src/geom.js').read_text(), (root / 'src/linkage.js').read_text()
assert '</script' not in core + app + geom + link, 'source must not contain a closing script tag'
html = (root / 'src/index.template.html').read_text().replace('/*CORE*/', core).replace('/*GEOM*/', geom + '\n' + link).replace('/*APP*/', app)
(root / 'index.html').write_text(html)
print(f'index.html written ({len(html):,} bytes)')
