import openpyxl, json
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
budgets = sheet_to_dicts(wb['Budgets'])
employees = {e['Employee ID']: e for e in sheet_to_dicts(wb['Employees'])}
vendors = {v['Vendor ID']: v for v in sheet_to_dicts(wb['Vendors'])}

print("=== TOTAL DATASET OVERVIEW ===")
print(f"Total Transactions: {len(txs)}")
total_spend = sum(t['Amount (INR)'] for t in txs if t.get('Amount (INR)') is not None)
print(f"Total Spend: INR {total_spend:,.2f}")

print("\n=== 1. STATUS BREAKDOWN ===")
status_spend = defaultdict(float)
status_count = Counter()
for t in txs:
    st = t.get('Transaction Status')
    amt = t.get('Amount (INR)', 0) or 0
    status_spend[st] += amt
    status_count[st] += 1
for st in status_spend:
    print(f"  {st}: INR {status_spend[st]:,.2f} ({status_count[st]} txs, {status_spend[st]/total_spend*100:.1f}%)")

print("\n=== 2. POLICY COMPLIANCE & EXCEPTIONS ===")
comp_count = Counter(t.get('Policy Compliant') for t in txs)
comp_spend = defaultdict(float)
for t in txs:
    comp_spend[t.get('Policy Compliant')] += t.get('Amount (INR)', 0) or 0
print(f"Compliant: {comp_count['Yes']} txs (INR {comp_spend['Yes']:,.2f})")
print(f"Non-Compliant: {comp_count['No']} txs (INR {comp_spend['No']:,.2f}, {comp_spend['No']/total_spend*100:.1f}%)")

reason_spend = defaultdict(float)
reason_count = Counter()
for t in txs:
    r = t.get('Policy Exception Reason')
    if r:
        reason_spend[r] += t.get('Amount (INR)', 0) or 0
        reason_count[r] += 1
for r in sorted(reason_spend, key=reason_spend.get, reverse=True):
    print(f"  Reason '{r}': INR {reason_spend[r]:,.2f} ({reason_count[r]} txs)")

print("\n=== 3. MISSING RECEIPTS ===")
rcpt_no = [t for t in txs if t.get('Receipt Attached') == 'No']
print(f"Missing Receipt Count: {len(rcpt_no)}, Total Spend: INR {sum(t['Amount (INR)'] for t in rcpt_no):,.2f}")
# How many missing receipt txs are marked completed or approved?
rcpt_no_approved = [t for t in rcpt_no if t.get('Approval Status') in ['Approved', 'Auto-approved']]
print(f"Missing Receipt but Approved/Auto-approved: {len(rcpt_no_approved)} txs (INR {sum(t['Amount (INR)'] for t in rcpt_no_approved):,.2f})")

print("\n=== 4. STRUCTURING / SPLIT TRANSACTIONS (SMURFING) ===")
# Look for same employee, same vendor, same day or consecutive days
emp_v_day = defaultdict(list)
for t in txs:
    k = (t['Employee ID'], t['Employee Name'], t['Vendor ID'], t['Vendor Name'], t['Transaction Date'])
    emp_v_day[k].append(t)

for k, v in emp_v_day.items():
    if len(v) > 1:
        tot = sum(x['Amount (INR)'] for x in v)
        print(f"Split detected: {k[1]} ({k[0]}) -> {k[3]} on {k[4]}: {len(v)} txs, total INR {tot:,.2f}")
        for x in v:
            print(f"    Tx {x['Transaction ID']}: INR {x['Amount (INR)']:,.2f} | Method: {x['Payment Method']} | Desc: {x['Description']}")

print("\n=== 5. APPROVAL CONTROLS & ANOMALIES ===")
# Self approvals
self_app = [t for t in txs if t['Employee Name'] == t.get('Approver')]
print(f"Self-approvals count: {len(self_app)}")
for t in self_app:
    print(f"  Self-approval: {t['Transaction ID']} by {t['Employee Name']} for INR {t['Amount (INR)']:,.2f} ({t['Spend Category']})")

# Approver turnaround times
tat_vals = [t['Approval Turnaround (Hours)'] for t in txs if isinstance(t.get('Approval Turnaround (Hours)'), (int, float))]
if tat_vals:
    print(f"TAT min: {min(tat_vals)}, max: {max(tat_vals)}, avg: {sum(tat_vals)/len(tat_vals):.2f}")
tat_120 = [t for t in txs if t.get('Approval Turnaround (Hours)') == 120]
print(f"TAT == 120 hours count: {len(tat_120)}")

# Approved Non-Compliant Spend
app_nc = [t for t in txs if t.get('Approval Status') == 'Approved' and t.get('Policy Compliant') == 'No']
print(f"Approved Non-Compliant: {len(app_nc)} txs, total INR {sum(t['Amount (INR)'] for t in app_nc):,.2f}")

# Auto-approved Non-Compliant Spend
auto_nc = [t for t in txs if t.get('Approval Status') == 'Auto-approved' and t.get('Policy Compliant') == 'No']
print(f"Auto-approved Non-Compliant: {len(auto_nc)} txs, total INR {sum(t['Amount (INR)'] for t in auto_nc):,.2f}")
for t in auto_nc:
    print(f"  Auto-approved NC: {t['Transaction ID']} | {t['Employee Name']} | {t['Vendor Name']} | INR {t['Amount (INR)']:,.2f} | Reason: {t['Policy Exception Reason']}")

print("\n=== 6. PAYMENT METHOD & RISKY DISBURSEMENTS ===")
pm_spend = defaultdict(float)
pm_count = Counter()
for t in txs:
    pm_spend[t['Payment Method']] += t['Amount (INR)']
    pm_count[t['Payment Method']] += 1
for pm in pm_spend:
    print(f"  {pm}: INR {pm_spend[pm]:,.2f} ({pm_count[pm]} txs)")

# Large reimbursements and UPI for high-risk categories (Contract Labour, Construction Materials)
high_risk_cats = ['Contract Labour', 'Construction Materials', 'Equipment Rental']
reimb_high_risk = [t for t in txs if t['Payment Method'] == 'Reimbursement' and t['Spend Category'] in high_risk_cats]
print(f"\nReimbursements for Construction/Labour/Equipment: {len(reimb_high_risk)} txs, Total INR {sum(t['Amount (INR)'] for t in reimb_high_risk):,.2f}")
upi_high_risk = [t for t in txs if t['Payment Method'] == 'UPI' and t['Spend Category'] in high_risk_cats]
print(f"UPI for Construction/Labour/Equipment: {len(upi_high_risk)} txs, Total INR {sum(t['Amount (INR)'] for t in upi_high_risk):,.2f}")

print("\n=== 7. VENDOR ANOMALIES & CONCENTRATION ===")
vendor_spend = defaultdict(float)
vendor_tx_cnt = Counter()
for t in txs:
    vendor_spend[t['Vendor Name']] += t['Amount (INR)']
    vendor_tx_cnt[t['Vendor Name']] += 1

for v, amt in sorted(vendor_spend.items(), key=lambda x: x[1], reverse=True):
    v_info = vendors.get(t['Vendor ID'], {})
    print(f"  {v}: INR {amt:,.2f} ({vendor_tx_cnt[v]} txs, {amt/total_spend*100:.1f}%)")

# Unregistered / Independent Vendor / Local Merchant / Employee Claim
informal_vendors = [t for t in txs if t['Vendor Name'] in ['Independent Vendor', 'Local Merchant', 'Employee Claim', 'Client Venue']]
print(f"\nInformal/Unregistered/Ad-hoc Vendors spend: {len(informal_vendors)} txs, INR {sum(t['Amount (INR)'] for t in informal_vendors):,.2f}")

print("\n=== 8. CURRENCY & FX USAGE ===")
curr_dist = Counter(t['Currency'] for t in txs)
print(f"Currency distribution: {curr_dist}")
foreign = [t for t in txs if t['Currency'] != 'INR']
for f in foreign[:10]:
    print(f"  {f['Transaction ID']}: {f['Employee Name']} | {f['Vendor Name']} | {f['Currency']} {f['Original Amount']} @ {f['FX Rate to INR']} = INR {f['Amount (INR)']:,.2f}")

print("\n=== 9. BUDGET VS ACTUAL VARIANCE ===")
# Aggregate budget by (Month, Department, Location)
b_dict = {}
for b in budgets:
    m = b['Month']
    if isinstance(m, str) and len(m) >= 7:
        m = m[:7]
    dept = b['Department']
    loc = b['Location / Site']
    b_dict[(m, dept, loc)] = b['Monthly Budget (INR)'] or 0

# Aggregate actual spend by (Month, Department, Location)
a_dict = defaultdict(float)
for t in txs:
    m = t['Month']
    if isinstance(m, str) and len(m) >= 7:
        m = m[:7]
    dept = t['Department']
    loc = t['Location / Site']
    a_dict[(m, dept, loc)] += t['Amount (INR)']

# Check over-budget
over_budgets = []
all_keys = set(b_dict.keys()) | set(a_dict.keys())
for k in all_keys:
    bg = b_dict.get(k, 0)
    act = a_dict.get(k, 0)
    if act > bg:
        over_budgets.append((k, bg, act, act - bg, (act/bg - 1)*100 if bg else 999))

print(f"Total budget combinations: {len(all_keys)}, Over budget count: {len(over_budgets)}")
over_budgets.sort(key=lambda x: x[3], reverse=True)
print("Top 10 Over-Budget instances:")
for ob in over_budgets[:10]:
    print(f"  {ob[0]}: Budget INR {ob[1]:,.2f} | Actual INR {ob[2]:,.2f} | Variance +INR {ob[3]:,.2f} (+{ob[4]:.1f}%)")

# Overall budget vs actual by Month
m_budget = defaultdict(float)
for (m, d, l), val in b_dict.items():
    m_budget[m] += val
m_actual = defaultdict(float)
for (m, d, l), val in a_dict.items():
    m_actual[m] += val

print("\nMonthly Budget vs Actual:")
for m in sorted(m_budget):
    bg = m_budget[m]
    act = m_actual[m]
    print(f"  {m}: Budget INR {bg:,.2f} | Actual INR {act:,.2f} | Variance INR {act-bg:,.2f} ({(act/bg-1)*100:+.1f}%)")

print("\n=== 10. WEEKEND SPENDS ===")
weekend_txs = [t for t in txs if t.get('Weekend Transaction') == 'Yes']
print(f"Weekend transactions: {len(weekend_txs)} txs, Total INR {sum(t['Amount (INR)'] for t in weekend_txs):,.2f}")

print("\n=== 11. TOP SPENDERS (EMPLOYEES) ===")
emp_spend = defaultdict(float)
emp_count = Counter()
for t in txs:
    emp_spend[t['Employee Name']] += t['Amount (INR)']
    emp_count[t['Employee Name']] += 1

for emp, amt in sorted(emp_spend.items(), key=lambda x: x[1], reverse=True)[:10]:
    emp_id = [t['Employee ID'] for t in txs if t['Employee Name'] == emp][0]
    dept = [t['Department'] for t in txs if t['Employee Name'] == emp][0]
    loc = [t['Location / Site'] for t in txs if t['Employee Name'] == emp][0]
    print(f"  {emp} ({emp_id}, {dept}, {loc}): INR {amt:,.2f} ({emp_count[emp]} txs)")
