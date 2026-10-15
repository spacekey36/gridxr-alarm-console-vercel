import openpyxl, json

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
dict_data = sheet_to_dicts(wb['Data Dictionary'])

for t in txs:
    try:
        t['Amount (INR)'] = float(t.get('Amount (INR)') or 0)
    except:
        t['Amount (INR)'] = 0.0
    if isinstance(t.get('Month'), str) and len(t['Month']) >= 7:
        t['Month'] = t['Month'][:7]
    if isinstance(t.get('Transaction Date'), str) and len(t['Transaction Date']) >= 10:
        t['Transaction Date'] = t['Transaction Date'][:10]
    # Parse turnaround
    try:
        if t.get('Approval Turnaround (Hours)') is not None:
            t['Approval Turnaround (Hours)'] = float(t['Approval Turnaround (Hours)'])
    except:
        t['Approval Turnaround (Hours)'] = None

for b in budgets:
    if isinstance(b.get('Month'), str) and len(b['Month']) >= 7:
        b['Month'] = b['Month'][:7]
    try:
        b['Monthly Budget (INR)'] = float(b.get('Monthly Budget (INR)') or 0)
    except:
        b['Monthly Budget (INR)'] = 0.0

js_content = f"window.DATA = {json.dumps({'transactions': txs, 'budgets': budgets, 'employees': employees, 'vendors': vendors, 'dictionary': dict_data}, ensure_ascii=False, indent=2)};"

with open(r'e:\ppt-icp\data.js', 'w', encoding='utf-8') as f:
    f.write(js_content)

print(f"Generated data.js with {len(txs)} txs, {len(budgets)} budgets.")
