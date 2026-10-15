import openpyxl
from collections import defaultdict, Counter

wb = openpyxl.load_workbook(r'C:\Users\gsanj\Downloads\Builder Assignment _ Spend Analytics Dashboard.xlsx', data_only=True)

def sheet_to_dicts(sheet):
    rows = list(sheet.iter_rows(values_only=True))
    if not rows: return []
    header = [str(c).strip() if c is not None else f'col_{i}' for i, c in enumerate(rows[0])]
    data = []
    for row in rows[1:]:
        if all(c is None for c in row): continue
        d = {}
        for h, v in zip(header, row):
            if hasattr(v, 'isoformat'):
                v = v.isoformat()
            d[h] = v
        data.append(d)
    return data

txs = sheet_to_dicts(wb['Transactions'])
employees = {e['Employee ID']: e for e in sheet_to_dicts(wb['Employees'])}
vendors = {v['Vendor ID']: v for v in sheet_to_dicts(wb['Vendors'])}

print("=== FINANCE HQ OVERSPEND ANALYSIS ===")
fin_hq = [t for t in txs if t['Department'] == 'Finance' and t['Location / Site'] == 'HQ - Bengaluru']
print(f"Finance HQ tx count: {len(fin_hq)}, Total spend: INR {sum(t['Amount (INR)'] for t in fin_hq):,.2f}")
fin_cats = defaultdict(float)
fin_vendors = defaultdict(float)
fin_emps = defaultdict(float)
for t in fin_hq:
    fin_cats[t['Spend Category']] += t['Amount (INR)']
    fin_vendors[t['Vendor Name']] += t['Amount (INR)']
    fin_emps[t['Employee Name']] += t['Amount (INR)']

print("Finance HQ Spend Categories:")
for c, a in sorted(fin_cats.items(), key=lambda x: x[1], reverse=True):
    print(f"  {c}: INR {a:,.2f}")

print("Finance HQ Vendors:")
for v, a in sorted(fin_vendors.items(), key=lambda x: x[1], reverse=True)[:5]:
    print(f"  {v}: INR {a:,.2f}")

print("Finance HQ Top Spenders:")
for e, a in sorted(fin_emps.items(), key=lambda x: x[1], reverse=True)[:5]:
    print(f"  {e}: INR {a:,.2f}")

print("\n=== FOREIGN CURRENCY DOMESTIC VENDORS ===")
for t in txs:
    v_id = t.get('Vendor ID')
    v_meta = vendors.get(v_id, {})
    if t['Currency'] != 'INR':
        # Check vendor type
        print(f"Tx {t['Transaction ID']}: {t['Vendor Name']} (Vendor Type in master: {v_meta.get('Vendor Type')}) | Curr: {t['Currency']} {t['Original Amount']} | INR {t['Amount (INR)']:,.2f} | Method: {t['Payment Method']}")

print("\n=== PROJECT / COST CENTRE MISMATCHES ===")
# Does location match Project?
proj_loc = defaultdict(Counter)
for t in txs:
    proj_loc[t['Project / Cost Centre']][t['Location / Site']] += 1
for p, locs in proj_loc.items():
    print(f"Project {p}: {dict(locs)}")

print("\n=== DUPLICATE INVOICE IDS ===")
inv_ids = defaultdict(list)
for t in txs:
    inv = t.get('Invoice / Receipt ID')
    if inv:
        inv_ids[inv].append(t)
dupes = {k: v for k, v in inv_ids.items() if len(v) > 1}
print(f"Duplicate Invoice IDs count: {len(dupes)}")
for k, v in list(dupes.items())[:5]:
    print(f"Invoice ID {k} used in {len(v)} txs:")
    for x in v:
        print(f"   {x['Transaction ID']} | {x['Employee Name']} | {x['Vendor Name']} | {x['Transaction Date']} | INR {x['Amount (INR)']:,.2f}")
