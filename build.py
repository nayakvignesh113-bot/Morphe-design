"""Build the single-file app: inlines src/core.js (Web Worker) and src/app.js into index.html."""
from pathlib import Path
root = Path(__file__).parent
core, app = (root / 'src/core.js').read_text(), (root / 'src/app.js').read_text()
assert '</script' not in core + app, 'source must not contain a closing script tag'
html = (root / 'src/index.template.html').read_text().replace('/*CORE*/', core).replace('/*APP*/', app)
(root / 'index.html').write_text(html)
print(f'index.html written ({len(html):,} bytes)')
