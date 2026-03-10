import json
from datetime import date
from pathlib import Path

p = Path(r'c:\Users\test\Desktop\AllIincompassing\tmp_client_authorization_normalized.json')
data = json.loads(p.read_text())
cleaned = []
for r in data:
    name = (r.get('full_name') or '').strip()
    if not name or name.upper() == 'CO':
        continue
    for k in ('auth_start_date','auth_end_date'):
        v = r.get(k)
        if isinstance(v, str) and len(v) == 10 and v[4] == '-' and v[7] == '-':
            try:
                y, m, d = map(int, v.split('-'))
                if y < 2000 or y > 2100:
                    r[k] = None
            except Exception:
                r[k] = None
    cleaned.append(r)

p.write_text(json.dumps(cleaned, ensure_ascii=True, indent=2), encoding='utf-8')
Path(r'c:\Users\test\Desktop\AllIincompassing\tmp_auth_batch1.json').write_text(json.dumps(cleaned[:55], ensure_ascii=True, separators=(',',':')), encoding='utf-8')
Path(r'c:\Users\test\Desktop\AllIincompassing\tmp_auth_batch2.json').write_text(json.dumps(cleaned[55:], ensure_ascii=True, separators=(',',':')), encoding='utf-8')
print('rows_cleaned',len(cleaned),'batch2',len(cleaned[55:]))
