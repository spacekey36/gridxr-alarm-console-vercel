import openpyxl, json
from datetime import datetime

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
            elif isinstance(v, float):
                v = round(v, 2)
            d[h] = v
        data.append(d)
    return data

txs = sheet_to_dicts(wb['Transactions'])
budgets = sheet_to_dicts(wb['Budgets'])
employees = sheet_to_dicts(wb['Employees'])
vendors = sheet_to_dicts(wb['Vendors'])

# Clean and normalize
for t in txs:
    # Ensure amount is float
    try:
        t['Amount (INR)'] = float(t.get('Amount (INR)') or 0)
    except:
        t['Amount (INR)'] = 0.0
    # Clean month format e.g. '2026-01-01' -> '2026-01'
    if isinstance(t.get('Month'), str) and len(t['Month']) >= 7:
        t['Month'] = t['Month'][:7]
    if isinstance(t.get('Transaction Date'), str) and len(t['Transaction Date']) >= 10:
        t['Transaction Date'] = t['Transaction Date'][:10]

for b in budgets:
    if isinstance(b.get('Month'), str) and len(b['Month']) >= 7:
        b['Month'] = b['Month'][:7]
    try:
        b['Monthly Budget (INR)'] = float(b.get('Monthly Budget (INR)') or 0)
    except:
        b['Monthly Budget (INR)'] = 0.0

with open(r'e:\ppt-icp\data.json', 'w', encoding='utf-8') as f:
    json.dump({
        'transactions': txs,
        'budgets': budgets,
        'employees': employees,
        'vendors': vendors
    }, f, indent=2)

print(f"Exported data.json with {len(txs)} txs, {len(budgets)} budgets, {len(employees)} emps, {len(vendors)} vendors.")
