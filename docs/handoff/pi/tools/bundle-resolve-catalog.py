# Catalog conflicts: keep HEAD's side (the dashboard PR owns the sectors), then drop sector entries
# for apps that no longer exist and report apps that are in no sector.
import json,re
p='vesper/catalog.json'; s=open(p).read()
s=re.sub(r'<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n', lambda m:m.group(1), s, flags=re.S)
c=json.loads(s)
ids={a['id'] for a in c['apps']}
for sec in c['sectors']:
    for a in list(sec['apps']):
        if a not in ids:
            print('  dropping', a, 'from sector', sec['name'])
            s=re.sub(r'\n\s*"%s",?(?=\n)'%re.escape(a), '', s, count=1)
c=json.loads(re.sub(r',(\s*\])', r'\1', s)); s=re.sub(r',(\s*\])', r'\1', s)
placed={a for sec in c['sectors'] for a in sec['apps']}
print('  sectors:', [(sec['name'], sec['apps']) for sec in c['sectors']])
print('  apps in no sector:', sorted(ids-placed))
open(p,'w').write(s)
