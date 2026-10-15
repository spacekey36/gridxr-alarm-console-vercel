// Spend Analytics Dashboard Logic for Northstar Projects Pvt Ltd
document.addEventListener('DOMContentLoaded', () => {
  // Validate data availability
  if (!window.DATA || !window.DATA.transactions) {
    console.error('Data not loaded');
    return;
  }

  const { transactions, budgets, employees, vendors, dictionary } = window.DATA;

  // Global state
  const state = {
    filters: {
      month: 'all',
      department: 'all',
      location: 'all',
      project: 'all',
      category: 'all',
      paymentMethod: 'all',
      policyCompliant: 'all',
      receiptAttached: 'all',
      status: 'all',
      search: '',
      preset: 'all'
    },
    pagination: {
      page: 1,
      pageSize: 25,
      sortCol: 'Transaction Date',
      sortAsc: false
    },
    currentTab: 'overview',
    charts: {}
  };

  // Precomputed helpers & mappings
  const vendorMap = {};
  vendors.forEach(v => { vendorMap[v['Vendor ID']] = v; });
  const employeeMap = {};
  employees.forEach(e => { employeeMap[e['Employee ID']] = e; });

  // Identify duplicate invoices
  const invoiceCounts = {};
  transactions.forEach(t => {
    const inv = t['Invoice / Receipt ID'];
    if (inv) {
      invoiceCounts[inv] = (invoiceCounts[inv] || 0) + 1;
    }
  });

  // Identify structured/smurfed transactions (Diya Sharma Metro Hardware urgent site tools)
  const smurfedTxIds = new Set(['T000905', 'T000906', 'T000907', 'T000908', 'T000909', 'T000910']);
  const duplicateTxIds = new Set(['T000120', 'T000901', 'T000345', 'T000902', 'T000610', 'T000903', 'T000775', 'T000904']);

  // Formatters
  const formatINR = (val, compact = false) => {
    if (val === null || val === undefined || isNaN(val)) return '₹0';
    if (compact) {
      if (Math.abs(val) >= 10000000) return `₹${(val / 10000000).toFixed(2)} Cr`;
      if (Math.abs(val) >= 100000) return `₹${(val / 100000).toFixed(2)} L`;
      if (Math.abs(val) >= 1000) return `₹${(val / 1000).toFixed(1)} K`;
    }
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(val);
  };

  const formatNumber = (val) => new Intl.NumberFormat('en-IN').format(val || 0);

  // Initialize Filter Select Options
  function populateFilterOptions() {
    const months = [...new Set(transactions.map(t => t.Month))].sort();
    const depts = [...new Set(transactions.map(t => t.Department))].sort();
    const locs = [...new Set(transactions.map(t => t['Location / Site']))].sort();
    const projs = [...new Set(transactions.map(t => t['Project / Cost Centre']))].sort();
    const cats = [...new Set(transactions.map(t => t['Spend Category']))].sort();
    const pms = [...new Set(transactions.map(t => t['Payment Method']))].sort();

    const addOptions = (selectId, items) => {
      const select = document.getElementById(selectId);
      if (!select) return;
      items.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item;
        opt.textContent = item;
        select.appendChild(opt);
      });
    };

    addOptions('filter-month', months);
    addOptions('filter-dept', depts);
    addOptions('filter-loc', locs);
    addOptions('filter-proj', projs);
    addOptions('filter-cat', cats);
    addOptions('filter-pm', pms);
  }

  // Filter Transactions Engine
  function getFilteredTransactions() {
    return transactions.filter(t => {
      // Preset filters
      if (state.filters.preset === 'forensic') {
        const isNC = t['Policy Compliant'] === 'No';
        const isMissingRcpt = t['Receipt Attached'] === 'No';
        const isSmurf = smurfedTxIds.has(t['Transaction ID']);
        const isDupe = duplicateTxIds.has(t['Transaction ID']);
        if (!isNC && !isMissingRcpt && !isSmurf && !isDupe) return false;
      } else if (state.filters.preset === 'smurfing') {
        if (!smurfedTxIds.has(t['Transaction ID'])) return false;
      } else if (state.filters.preset === 'duplicate') {
        if (!duplicateTxIds.has(t['Transaction ID'])) return false;
      } else if (state.filters.preset === 'missing-rcpt') {
        if (t['Receipt Attached'] !== 'No') return false;
      } else if (state.filters.preset === 'upi-reimb') {
        if (t['Payment Method'] !== 'UPI' && t['Payment Method'] !== 'Reimbursement') return false;
      } else if (state.filters.preset === 'foreign-curr') {
        if (t['Currency'] === 'INR') return false;
      } else if (state.filters.preset === 'weekend') {
        if (t['Weekend Transaction'] !== 'Yes') return false;
      }

      // Dropdown filters
      if (state.filters.month !== 'all' && t.Month !== state.filters.month) return false;
      if (state.filters.department !== 'all' && t.Department !== state.filters.department) return false;
      if (state.filters.location !== 'all' && t['Location / Site'] !== state.filters.location) return false;
      if (state.filters.project !== 'all' && t['Project / Cost Centre'] !== state.filters.project) return false;
      if (state.filters.category !== 'all' && t['Spend Category'] !== state.filters.category) return false;
      if (state.filters.paymentMethod !== 'all' && t['Payment Method'] !== state.filters.paymentMethod) return false;
      if (state.filters.policyCompliant !== 'all' && t['Policy Compliant'] !== state.filters.policyCompliant) return false;
      if (state.filters.receiptAttached !== 'all' && t['Receipt Attached'] !== state.filters.receiptAttached) return false;
      if (state.filters.status !== 'all' && t['Transaction Status'] !== state.filters.status) return false;

      // Text search
      if (state.filters.search) {
        const q = state.filters.search.toLowerCase();
        const searchPool = [
          t['Transaction ID'],
          t['Employee Name'],
          t['Employee ID'],
          t['Vendor Name'],
          t['Description'],
          t['Approver'],
          t['Invoice / Receipt ID'] || ''
        ].join(' ').toLowerCase();
        if (!searchPool.includes(q)) return false;
      }

      return true;
    });
  }

  // Calculate Budget for Filtered Scope
  function getFilteredBudget() {
    return budgets.filter(b => {
      if (state.filters.month !== 'all' && b.Month !== state.filters.month) return false;
      if (state.filters.department !== 'all' && b.Department !== state.filters.department) return false;
      if (state.filters.location !== 'all' && b['Location / Site'] !== state.filters.location) return false;
      return true;
    }).reduce((sum, b) => sum + (b['Monthly Budget (INR)'] || 0), 0);
  }

  // Update Top KPIs
  function updateKPIs(filteredTxs) {
    const totalSpend = filteredTxs.reduce((sum, t) => sum + (t['Amount (INR)'] || 0), 0);
    const completedSpend = filteredTxs
      .filter(t => t['Transaction Status'] === 'Completed')
      .reduce((sum, t) => sum + (t['Amount (INR)'] || 0), 0);
    const txCount = filteredTxs.length;
    const avgTx = txCount > 0 ? totalSpend / txCount : 0;

    // Budget & Variance
    const allocatedBudget = getFilteredBudget();
    const budgetVariance = allocatedBudget - totalSpend;
    const budgetUtil = allocatedBudget > 0 ? (totalSpend / allocatedBudget) * 100 : 0;

    // Policy breaches
    const nonCompliantTxs = filteredTxs.filter(t => t['Policy Compliant'] === 'No');
    const nonCompliantSpend = nonCompliantTxs.reduce((sum, t) => sum + (t['Amount (INR)'] || 0), 0);
    const nonCompliantPct = totalSpend > 0 ? (nonCompliantSpend / totalSpend) * 100 : 0;

    // Missing Receipts
    const missingRcptTxs = filteredTxs.filter(t => t['Receipt Attached'] === 'No');
    const missingRcptSpend = missingRcptTxs.reduce((sum, t) => sum + (t['Amount (INR)'] || 0), 0);

    // High Risk Disbursed (UPI + Reimbursement)
    const uncontrolledSpend = filteredTxs
      .filter(t => t['Payment Method'] === 'UPI' || t['Payment Method'] === 'Reimbursement')
      .reduce((sum, t) => sum + (t['Amount (INR)'] || 0), 0);
    const uncontrolledPct = totalSpend > 0 ? (uncontrolledSpend / totalSpend) * 100 : 0;

    // Approvals Turnaround
    const tatTxs = filteredTxs.filter(t => typeof t['Approval Turnaround (Hours)'] === 'number');
    const avgTAT = tatTxs.length > 0 ? tatTxs.reduce((sum, t) => sum + t['Approval Turnaround (Hours)'], 0) / tatTxs.length : 0;
    const autoApprovedCount = filteredTxs.filter(t => t['Approval Status'] === 'Auto-approved').length;

    // Render into DOM
    document.getElementById('kpi-total-spend').textContent = formatINR(totalSpend);
    document.getElementById('kpi-spend-sub').innerHTML = `Completed: <strong>${formatINR(completedSpend, true)}</strong> (${formatNumber(txCount)} txs, Avg: ${formatINR(avgTx)})`;

    document.getElementById('kpi-budget-util').textContent = `${budgetUtil.toFixed(1)}%`;
    const varClass = budgetVariance >= 0 ? 'positive' : 'negative';
    const varPrefix = budgetVariance >= 0 ? '+' : '';
    document.getElementById('kpi-budget-sub').innerHTML = `Budget: ${formatINR(allocatedBudget, true)} | Variance: <span class="${varClass}">${varPrefix}${formatINR(budgetVariance, true)}</span>`;

    document.getElementById('kpi-policy-breach').textContent = formatINR(nonCompliantSpend);
    document.getElementById('kpi-policy-sub').innerHTML = `<span class="negative">${nonCompliantPct.toFixed(1)}% of spend</span> (${formatNumber(nonCompliantTxs.length)} policy violations)`;

    document.getElementById('kpi-missing-rcpt').textContent = formatINR(missingRcptSpend);
    document.getElementById('kpi-missing-sub').innerHTML = `<span class="warning">${formatNumber(missingRcptTxs.length)} claims unverified</span> (${(totalSpend > 0 ? missingRcptSpend / totalSpend * 100 : 0).toFixed(1)}% of spend)`;

    document.getElementById('kpi-uncontrolled-pm').textContent = `${uncontrolledPct.toFixed(1)}%`;
    document.getElementById('kpi-uncontrolled-sub').innerHTML = `Total: ${formatINR(uncontrolledSpend, true)} (UPI + Personal Reimb)`;

    document.getElementById('kpi-tat').textContent = `${avgTAT.toFixed(1)}h`;
    document.getElementById('kpi-tat-sub').innerHTML = `Auto-approved: <strong>${autoApprovedCount}</strong> (${(txCount > 0 ? autoApprovedCount / txCount * 100 : 0).toFixed(1)}%)`;

    // Active filter count badge
    let activeFilterCount = 0;
    Object.keys(state.filters).forEach(k => {
      if (k === 'preset') {
        if (state.filters[k] !== 'all') activeFilterCount++;
      } else if (k === 'search') {
        if (state.filters[k]) activeFilterCount++;
      } else {
        if (state.filters[k] !== 'all') activeFilterCount++;
      }
    });
    const filterBadge = document.getElementById('active-filter-badge');
    if (filterBadge) {
      filterBadge.textContent = `${activeFilterCount} active`;
      filterBadge.style.display = activeFilterCount > 0 ? 'inline-block' : 'none';
    }
  }

  // ================= CHART RENDERERS =================
  function renderCharts(filteredTxs) {
    if (typeof Chart === 'undefined') {
      console.warn('Chart.js not ready');
      return;
    }

    // Common Chart options for Volopay Light Palette
    Chart.defaults.color = '#64748b';
    Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";
    Chart.defaults.borderColor = '#eaedf5';
    if (Chart.defaults.plugins && Chart.defaults.plugins.tooltip) {
      Chart.defaults.plugins.tooltip.backgroundColor = '#1e1b4b';
      Chart.defaults.plugins.tooltip.titleColor = '#ffffff';
      Chart.defaults.plugins.tooltip.bodyColor = '#f8f9fd';
      Chart.defaults.plugins.tooltip.borderColor = '#5631bd';
      Chart.defaults.plugins.tooltip.borderWidth = 1;
      Chart.defaults.plugins.tooltip.padding = 10;
      Chart.defaults.plugins.tooltip.cornerRadius = 6;
    }

    // Helper to safely destroy and re-create charts
    const createOrUpdate = (canvasId, config) => {
      if (state.charts[canvasId]) {
        state.charts[canvasId].destroy();
      }
      const canvas = document.getElementById(canvasId);
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      state.charts[canvasId] = new Chart(ctx, config);
      return state.charts[canvasId];
    };

    // 1. Monthly Spend Trend Chart
    const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
    const monthlyCompleted = months.map(m => {
      return filteredTxs
        .filter(t => t.Month === m && t['Transaction Status'] === 'Completed')
        .reduce((sum, t) => sum + (t['Amount (INR)'] || 0), 0);
    });
    const monthlyPending = months.map(m => {
      return filteredTxs
        .filter(t => t.Month === m && t['Transaction Status'] === 'Pending')
        .reduce((sum, t) => sum + (t['Amount (INR)'] || 0), 0);
    });
    const monthlyOther = months.map(m => {
      return filteredTxs
        .filter(t => t.Month === m && (t['Transaction Status'] === 'Declined' || t['Transaction Status'] === 'Reversed'))
        .reduce((sum, t) => sum + (t['Amount (INR)'] || 0), 0);
    });

    createOrUpdate('chart-monthly-trend', {
      type: 'bar',
      data: {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'],
        datasets: [
          {
            label: 'Completed',
            data: monthlyCompleted,
            backgroundColor: '#5631bd', // Volopay Purple
            borderRadius: 4
          },
          {
            label: 'Pending',
            data: monthlyPending,
            backgroundColor: '#f59e0b',
            borderRadius: 4
          },
          {
            label: 'Declined/Reversed',
            data: monthlyOther,
            backgroundColor: '#94a3b8',
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, color: '#475569' } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${formatINR(ctx.raw)}`
            }
          }
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: {
            stacked: true,
            grid: { color: '#f1f5f9' },
            ticks: {
              callback: (val) => formatINR(val, true)
            }
          }
        }
      }
    });

    // 2. Category Spend (Horizontal Bar)
    const catMap = {};
    filteredTxs.forEach(t => {
      catMap[t['Spend Category']] = (catMap[t['Spend Category']] || 0) + (t['Amount (INR)'] || 0);
    });
    const sortedCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 10);

    createOrUpdate('chart-category-spend', {
      type: 'bar',
      data: {
        labels: sortedCats.map(c => c[0]),
        datasets: [{
          label: 'Total Spend',
          data: sortedCats.map(c => c[1]),
          backgroundColor: '#5631bd', // Volopay Purple
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => formatINR(ctx.raw)
            }
          }
        },
        scales: {
          x: {
            grid: { color: '#f1f5f9' },
            ticks: { callback: (val) => formatINR(val, true) }
          },
          y: { grid: { display: false } }
        }
      }
    });

    // 3. Payment Method Breakdown (Doughnut)
    const pmMap = {};
    filteredTxs.forEach(t => {
      pmMap[t['Payment Method']] = (pmMap[t['Payment Method']] || 0) + (t['Amount (INR)'] || 0);
    });

    createOrUpdate('chart-pm-donut', {
      type: 'doughnut',
      data: {
        labels: Object.keys(pmMap),
        datasets: [{
          data: Object.values(pmMap),
          backgroundColor: ['#5631bd', '#10b981', '#f59e0b', '#0ea5e9'],
          borderWidth: 3,
          borderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14, color: '#475569' } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${formatINR(ctx.raw)} (${(ctx.raw / (Object.values(pmMap).reduce((a,b)=>a+b,0) || 1) * 100).toFixed(1)}%)`
            }
          }
        }
      }
    });

    // 4. Department Spend vs Budget (Overview Tab)
    const depts = ['Projects', 'Procurement', 'Finance', 'Operations', 'IT', 'Sales', 'Admin', 'People'];
    const deptSpend = depts.map(d => {
      return filteredTxs.filter(t => t.Department === d).reduce((sum, t) => sum + (t['Amount (INR)'] || 0), 0);
    });
    const deptBudget = depts.map(d => {
      return budgets.filter(b => b.Department === d).reduce((sum, b) => sum + (b['Monthly Budget (INR)'] || 0), 0);
    });

    createOrUpdate('chart-dept-spend', {
      type: 'bar',
      data: {
        labels: depts,
        datasets: [
          {
            label: 'Actual Spend',
            data: deptSpend,
            backgroundColor: '#5631bd', // Volopay Purple
            borderRadius: 4
          },
          {
            label: 'Allocated Budget',
            data: deptBudget,
            backgroundColor: '#e2e8f0', // Clean contrast light gray
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, color: '#475569' } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${formatINR(ctx.raw)}`
            }
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { color: '#f1f5f9' },
            ticks: { callback: (val) => formatINR(val, true) }
          }
        }
      }
    });

    // 5. Site / Location Spend (Bar chart)
    const locMap = {};
    filteredTxs.forEach(t => {
      locMap[t['Location / Site']] = (locMap[t['Location / Site']] || 0) + (t['Amount (INR)'] || 0);
    });
    const sortedLocs = Object.entries(locMap).sort((a, b) => b[1] - a[1]);

    createOrUpdate('chart-location-spend', {
      type: 'bar',
      data: {
        labels: sortedLocs.map(l => l[0]),
        datasets: [{
          label: 'Location Spend',
          data: sortedLocs.map(l => l[1]),
          backgroundColor: '#7c3aed', // Accent Purple
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => formatINR(ctx.raw)
            }
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { color: '#f1f5f9' },
            ticks: { callback: (val) => formatINR(val, true) }
          }
        }
      }
    });

    // 6. Policy Exception Breakdown (Doughnut)
    const peMap = {};
    filteredTxs.filter(t => t['Policy Exception Reason']).forEach(t => {
      peMap[t['Policy Exception Reason']] = (peMap[t['Policy Exception Reason']] || 0) + 1;
    });

    createOrUpdate('chart-policy-reasons', {
      type: 'doughnut',
      data: {
        labels: Object.keys(peMap),
        datasets: [{
          data: Object.values(peMap),
          backgroundColor: ['#ef4444', '#f59e0b', '#5631bd', '#0ea5e9', '#ec4899'],
          borderWidth: 3,
          borderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 }, color: '#475569' } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${ctx.raw} violations`
            }
          }
        }
      }
    });

    // 7. Top 10 Vendors Chart (Vendor Tab)
    const vMap = {};
    filteredTxs.forEach(t => {
      vMap[t['Vendor Name']] = (vMap[t['Vendor Name']] || 0) + (t['Amount (INR)'] || 0);
    });
    const sortedVendors = Object.entries(vMap).sort((a, b) => b[1] - a[1]).slice(0, 10);

    createOrUpdate('chart-top-vendors', {
      type: 'bar',
      data: {
        labels: sortedVendors.map(v => v[0]),
        datasets: [{
          label: 'Total Spend',
          data: sortedVendors.map(v => v[1]),
          backgroundColor: '#10b981',
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => formatINR(ctx.raw)
            }
          }
        },
        scales: {
          x: {
            grid: { color: '#f1f5f9' },
            ticks: { callback: (val) => formatINR(val, true) }
          },
          y: { grid: { display: false } }
        }
      }
    });

    // 8. Turnaround Time Distribution Chart
    const tatBuckets = { '< 2h': 0, '2 - 12h': 0, '12 - 24h': 0, '24 - 48h': 0, '> 48h': 0, '120h (Max)': 0 };
    filteredTxs.forEach(t => {
      const tat = t['Approval Turnaround (Hours)'];
      if (typeof tat === 'number') {
        if (tat === 120) tatBuckets['120h (Max)']++;
        else if (tat < 2) tatBuckets['< 2h']++;
        else if (tat <= 12) tatBuckets['2 - 12h']++;
        else if (tat <= 24) tatBuckets['12 - 24h']++;
        else if (tat <= 48) tatBuckets['24 - 48h']++;
        else tatBuckets['> 48h']++;
      }
    });

    createOrUpdate('chart-tat-dist', {
      type: 'bar',
      data: {
        labels: Object.keys(tatBuckets),
        datasets: [{
          label: 'Approvals Count',
          data: Object.values(tatBuckets),
          backgroundColor: '#5631bd', // Volopay Purple
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: '#f1f5f9' } }
        }
      }
    });
  }

  // ================= TAB 2: BUDGET VS ACTUALS TABLE =================
  function renderBudgetTables(filteredTxs) {
    const tableBody = document.getElementById('budget-variance-tbody');
    if (!tableBody) return;

    // Aggregate by Department
    const depts = ['Finance', 'IT', 'Admin', 'Projects', 'Procurement', 'Operations', 'Sales', 'People'];
    const deptRows = depts.map(dept => {
      const actual = filteredTxs
        .filter(t => t.Department === dept)
        .reduce((sum, t) => sum + (t['Amount (INR)'] || 0), 0);
      const budget = budgets
        .filter(b => b.Department === dept)
        .reduce((sum, b) => sum + (b['Monthly Budget (INR)'] || 0), 0);
      const variance = budget - actual;
      const utilPct = budget > 0 ? (actual / budget) * 100 : 0;
      return { dept, budget, actual, variance, utilPct };
    });

    // Sort by utilization descending
    deptRows.sort((a, b) => b.utilPct - a.utilPct);

    tableBody.innerHTML = deptRows.map(r => {
      let statusBadge = '<span class="badge badge-success">On Track</span>';
      if (r.utilPct > 100) statusBadge = '<span class="badge badge-danger">OVER BUDGET</span>';
      else if (r.utilPct > 70) statusBadge = '<span class="badge badge-warning">Elevated</span>';

      const varClass = r.variance >= 0 ? 'color: #34d399;' : 'color: #fb7185; font-weight: 700;';
      const varSign = r.variance >= 0 ? '+' : '';

      return `
        <tr>
          <td><strong>${r.dept}</strong></td>
          <td>${formatINR(r.budget)}</td>
          <td><strong>${formatINR(r.actual)}</strong></td>
          <td style="${varClass}">${varSign}${formatINR(r.variance)}</td>
          <td>
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="width: 80px; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
                <div style="width: ${Math.min(r.utilPct, 100)}%; height: 100%; background: ${r.utilPct > 100 ? '#f43f5e' : (r.utilPct > 70 ? '#f59e0b' : '#10b981')};"></div>
              </div>
              <span>${r.utilPct.toFixed(1)}%</span>
            </div>
          </td>
          <td>${statusBadge}</td>
        </tr>
      `;
    }).join('');

    // Site / Location variance table
    const siteTableBody = document.getElementById('site-variance-tbody');
    if (!siteTableBody) return;

    const locs = [...new Set(budgets.map(b => b['Location / Site']))].sort();
    const siteRows = locs.map(loc => {
      const actual = filteredTxs
        .filter(t => t['Location / Site'] === loc)
        .reduce((sum, t) => sum + (t['Amount (INR)'] || 0), 0);
      const budget = budgets
        .filter(b => b['Location / Site'] === loc)
        .reduce((sum, b) => sum + (b['Monthly Budget (INR)'] || 0), 0);
      const variance = budget - actual;
      const utilPct = budget > 0 ? (actual / budget) * 100 : 0;
      return { loc, budget, actual, variance, utilPct };
    });

    siteRows.sort((a, b) => b.utilPct - a.utilPct);

    siteTableBody.innerHTML = siteRows.map(r => {
      let statusBadge = '<span class="badge badge-success">Within Budget</span>';
      if (r.utilPct > 100) statusBadge = '<span class="badge badge-danger">OVER BUDGET</span>';
      else if (r.utilPct > 70) statusBadge = '<span class="badge badge-warning">Elevated</span>';

      const varClass = r.variance >= 0 ? 'color: #34d399;' : 'color: #fb7185; font-weight: 700;';
      const varSign = r.variance >= 0 ? '+' : '';

      return `
        <tr>
          <td><strong>${r.loc}</strong></td>
          <td>${formatINR(r.budget)}</td>
          <td><strong>${formatINR(r.actual)}</strong></td>
          <td style="${varClass}">${varSign}${formatINR(r.variance)}</td>
          <td>${r.utilPct.toFixed(1)}%</td>
          <td>${statusBadge}</td>
        </tr>
      `;
    }).join('');
  }

  // ================= TAB 3: FORENSIC AUDIT CENTER =================
  function renderForensicAudit() {
    // 1. Smurfing Transactions
    const smurfContainer = document.getElementById('forensic-smurfing-list');
    if (smurfContainer) {
      const smurfTxs = transactions.filter(t => smurfedTxIds.has(t['Transaction ID']));
      smurfContainer.innerHTML = smurfTxs.map(t => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.04);">
          <div>
            <span style="font-family: monospace; font-weight: 700; color: #60a5fa;">${t['Transaction ID']}</span>
            <span style="color: var(--text-muted); margin-left: 8px;">${t['Transaction Date']}</span>
            <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">
              ${t['Employee Name']} (${t['Location / Site']}) &rarr; ${t['Vendor Name']} (${t['Payment Method']})
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-weight: 800; color: #fb7185;">${formatINR(t['Amount (INR)'])}</div>
            <span class="badge badge-danger">Below ₹50K Limit</span>
          </div>
        </div>
      `).join('');
    }

    // 2. Duplicate Invoices
    const dupeContainer = document.getElementById('forensic-duplicates-list');
    if (dupeContainer) {
      const dupeTxs = transactions.filter(t => duplicateTxIds.has(t['Transaction ID']));
      // Group by Invoice ID
      const byInvoice = {};
      dupeTxs.forEach(t => {
        const inv = t['Invoice / Receipt ID'];
        if (!byInvoice[inv]) byInvoice[inv] = [];
        byInvoice[inv].push(t);
      });

      dupeContainer.innerHTML = Object.entries(byInvoice).map(([inv, items]) => `
        <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(244,63,94,0.3); border-radius: 6px; padding: 12px; margin-bottom: 10px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <span style="font-weight: 700; color: #f43f5e;">Invoice: ${inv}</span>
            <span class="badge badge-danger">Double Claim (${items.length} txs)</span>
          </div>
          ${items.map(x => `
            <div style="font-size: 12px; display: flex; justify-content: space-between; color: var(--text-secondary); padding: 3px 0;">
              <span>${x['Transaction ID']} | ${x['Transaction Date']} | ${x['Employee Name']} (${x['Vendor Name']})</span>
              <strong style="color: var(--text-primary);">${formatINR(x['Amount (INR)'])}</strong>
            </div>
          `).join('')}
        </div>
      `).join('');
    }

    // 3. Foreign Currency Domestic Vendors
    const fxContainer = document.getElementById('forensic-fx-list');
    if (fxContainer) {
      const fxTxs = transactions.filter(t => t['Currency'] !== 'INR');
      const domesticFx = fxTxs.filter(t => {
        const v = vendorMap[t['Vendor ID']];
        return v && v['Vendor Type'] === 'Domestic';
      });

      fxContainer.innerHTML = domesticFx.slice(0, 8).map(t => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 12px;">
          <div>
            <strong style="color: var(--text-primary);">${t['Vendor Name']}</strong>
            <span style="color: var(--text-muted); margin-left: 6px;">(${t['Location / Site']})</span>
            <div style="color: var(--text-muted);">${t['Employee Name']} &bull; ${t['Spend Category']}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-weight: 700; color: #c4b5fd;">${t['Currency']} ${t['Original Amount']} @ ${t['FX Rate to INR']}</div>
            <div style="font-size: 11px; color: var(--text-secondary);">INR ${formatINR(t['Amount (INR)'])}</div>
          </div>
        </div>
      `).join('');
    }
  }

  // ================= TAB 4: VENDORS TABLE =================
  function renderVendorTable(filteredTxs) {
    const tableBody = document.getElementById('vendor-analysis-tbody');
    if (!tableBody) return;

    const vMap = {};
    filteredTxs.forEach(t => {
      const vName = t['Vendor Name'];
      if (!vMap[vName]) {
        vMap[vName] = {
          id: t['Vendor ID'] || 'N/A',
          name: vName,
          category: t['Spend Category'],
          spend: 0,
          count: 0,
          paymentMethods: {},
          currencies: {}
        };
      }
      vMap[vName].spend += (t['Amount (INR)'] || 0);
      vMap[vName].count += 1;
      vMap[vName].paymentMethods[t['Payment Method']] = (vMap[vName].paymentMethods[t['Payment Method']] || 0) + 1;
      vMap[vName].currencies[t['Currency']] = (vMap[vName].currencies[t['Currency']] || 0) + 1;
    });

    const totalFilteredSpend = filteredTxs.reduce((sum, t) => sum + (t['Amount (INR)'] || 0), 0) || 1;
    const sorted = Object.values(vMap).sort((a, b) => b.spend - a.spend);

    tableBody.innerHTML = sorted.map((v, idx) => {
      const masterInfo = vendorMap[v.id] || {};
      const criticality = masterInfo['Vendor Criticality'] || 'Standard';
      const terms = masterInfo['Payment Terms'] || '30 days';
      const vType = masterInfo['Vendor Type'] || (['Independent Vendor', 'Local Merchant', 'Employee Claim', 'Client Venue'].includes(v.name) ? 'Ad-Hoc / Informal' : 'Domestic');
      const pct = (v.spend / totalFilteredSpend * 100).toFixed(1);

      let critBadge = `<span class="badge badge-info">${criticality}</span>`;
      if (criticality === 'Critical') critBadge = `<span class="badge badge-danger">Critical</span>`;
      else if (criticality === 'Strategic') critBadge = `<span class="badge badge-purple">Strategic</span>`;

      // Top payment method used
      const topPm = Object.entries(v.paymentMethods).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'N/A';

      return `
        <tr>
          <td><span style="color: var(--text-muted); font-size: 11px;">#${idx+1}</span> <strong>${v.name}</strong></td>
          <td>${v.category}</td>
          <td>${critBadge}</td>
          <td>${terms}</td>
          <td><span class="badge badge-secondary">${topPm}</span></td>
          <td><strong>${formatINR(v.spend)}</strong></td>
          <td>
            <div style="display: flex; align-items: center; gap: 6px;">
              <div style="width: 60px; height: 5px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
                <div style="width: ${pct}%; height: 100%; background: #10b981;"></div>
              </div>
              <span style="font-size: 11px;">${pct}%</span>
            </div>
          </td>
          <td>${v.count}</td>
        </tr>
      `;
    }).join('');
  }

  // ================= TAB 5: EMPLOYEES & APPROVALS =================
  function renderApprovalsView(filteredTxs) {
    const approverTbody = document.getElementById('approvers-tbody');
    if (!approverTbody) return;

    const appMap = {};
    filteredTxs.forEach(t => {
      const app = t['Approver'] || 'System / None';
      if (!appMap[app]) {
        appMap[app] = {
          name: app,
          approvedSpend: 0,
          approvedCount: 0,
          rejectedCount: 0,
          nonCompliantApproved: 0,
          missingRcptApproved: 0,
          tats: []
        };
      }
      if (t['Approval Status'] === 'Approved' || t['Approval Status'] === 'Auto-approved') {
        appMap[app].approvedSpend += (t['Amount (INR)'] || 0);
        appMap[app].approvedCount += 1;
        if (t['Policy Compliant'] === 'No') appMap[app].nonCompliantApproved += 1;
        if (t['Receipt Attached'] === 'No') appMap[app].missingRcptApproved += 1;
      } else if (t['Approval Status'] === 'Rejected') {
        appMap[app].rejectedCount += 1;
      }
      if (typeof t['Approval Turnaround (Hours)'] === 'number') {
        appMap[app].tats.push(t['Approval Turnaround (Hours)']);
      }
    });

    const sorted = Object.values(appMap).sort((a, b) => b.approvedSpend - a.approvedSpend);

    approverTbody.innerHTML = sorted.map(a => {
      const avgTat = a.tats.length > 0 ? (a.tats.reduce((x, y) => x + y, 0) / a.tats.length).toFixed(1) : '-';
      return `
        <tr>
          <td><strong>${a.name}</strong></td>
          <td><strong>${formatINR(a.approvedSpend)}</strong></td>
          <td>${a.approvedCount}</td>
          <td>${a.rejectedCount}</td>
          <td>
            ${a.nonCompliantApproved > 0 ? `<span class="badge badge-danger">${a.nonCompliantApproved} claims</span>` : '<span class="badge badge-success">0</span>'}
          </td>
          <td>
            ${a.missingRcptApproved > 0 ? `<span class="badge badge-warning">${a.missingRcptApproved} missing</span>` : '<span class="badge badge-success">0</span>'}
          </td>
          <td>${avgTat !== '-' ? `${avgTat}h` : '-'}</td>
        </tr>
      `;
    }).join('');

    // Top Employee Spenders table
    const empTbody = document.getElementById('top-employees-tbody');
    if (!empTbody) return;

    const empSpendMap = {};
    filteredTxs.forEach(t => {
      const eId = t['Employee ID'];
      if (!empSpendMap[eId]) {
        empSpendMap[eId] = {
          id: eId,
          name: t['Employee Name'],
          dept: t['Department'],
          role: t['Role'],
          loc: t['Location / Site'],
          totalSpend: 0,
          txCount: 0,
          violations: 0
        };
      }
      empSpendMap[eId].totalSpend += (t['Amount (INR)'] || 0);
      empSpendMap[eId].txCount += 1;
      if (t['Policy Compliant'] === 'No') empSpendMap[eId].violations += 1;
    });

    const topEmps = Object.values(empSpendMap).sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 15);

    empTbody.innerHTML = topEmps.map(e => `
      <tr>
        <td><strong>${e.name}</strong> <span style="color: var(--text-muted); font-size: 11px;">(${e.id})</span></td>
        <td>${e.dept}</td>
        <td>${e.role}</td>
        <td>${e.loc}</td>
        <td><strong>${formatINR(e.totalSpend)}</strong></td>
        <td>${e.txCount}</td>
        <td>
          ${e.violations > 0 ? `<span class="badge badge-danger">${e.violations}</span>` : '<span class="badge badge-success">0</span>'}
        </td>
      </tr>
    `).join('');
  }

  // ================= TAB 6: TRANSACTION LEDGER =================
  function renderTransactionLedger(filteredTxs) {
    const tableBody = document.getElementById('tx-ledger-tbody');
    if (!tableBody) return;

    // Sort transactions
    const { sortCol, sortAsc, page, pageSize } = state.pagination;
    const sorted = [...filteredTxs].sort((a, b) => {
      let vA = a[sortCol];
      let vB = b[sortCol];
      if (typeof vA === 'string') vA = vA.toLowerCase();
      if (typeof vB === 'string') vB = vB.toLowerCase();
      if (vA < vB) return sortAsc ? -1 : 1;
      if (vA > vB) return sortAsc ? 1 : -1;
      return 0;
    });

    const totalPages = Math.ceil(sorted.length / pageSize) || 1;
    const currentPage = Math.min(Math.max(page, 1), totalPages);
    state.pagination.page = currentPage;

    const startIdx = (currentPage - 1) * pageSize;
    const pageItems = sorted.slice(startIdx, startIdx + pageSize);

    tableBody.innerHTML = pageItems.map(t => {
      // Risk tags
      const badges = [];
      if (t['Policy Compliant'] === 'No') {
        badges.push(`<span class="badge badge-danger" title="${t['Policy Exception Reason']}">${t['Policy Exception Reason'] || 'Non-Compliant'}</span>`);
      }
      if (t['Receipt Attached'] === 'No') {
        badges.push('<span class="badge badge-warning">No Receipt</span>');
      }
      if (smurfedTxIds.has(t['Transaction ID'])) {
        badges.push('<span class="badge badge-danger">SMURFING ALERT</span>');
      }
      if (duplicateTxIds.has(t['Transaction ID'])) {
        badges.push('<span class="badge badge-danger">DUPLICATE</span>');
      }
      if (t['Currency'] !== 'INR') {
        badges.push(`<span class="badge badge-purple">${t['Currency']} ${t['Original Amount']}</span>`);
      }
      if (t['Weekend Transaction'] === 'Yes') {
        badges.push('<span class="badge badge-info">Weekend</span>');
      }

      let statusBadge = '<span class="badge badge-success">Completed</span>';
      if (t['Transaction Status'] === 'Pending') statusBadge = '<span class="badge badge-warning">Pending</span>';
      else if (t['Transaction Status'] === 'Declined') statusBadge = '<span class="badge badge-danger">Declined</span>';
      else if (t['Transaction Status'] === 'Reversed') statusBadge = '<span class="badge badge-secondary">Reversed</span>';

      return `
        <tr data-txid="${t['Transaction ID']}" style="cursor: pointer;">
          <td><span style="font-family: monospace; font-weight: 700; color: #60a5fa;">${t['Transaction ID']}</span></td>
          <td>${t['Transaction Date']}</td>
          <td><strong>${t['Employee Name']}</strong><br><span style="font-size: 11px; color: var(--text-muted);">${t['Department']} &bull; ${t['Location / Site']}</span></td>
          <td>${t['Vendor Name']}</td>
          <td>${t['Spend Category']}</td>
          <td><span class="badge badge-secondary">${t['Payment Method']}</span></td>
          <td><strong>${formatINR(t['Amount (INR)'])}</strong></td>
          <td>${statusBadge}</td>
          <td>${badges.join(' ')}</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="window.viewTxDetail('${t['Transaction ID']}'); event.stopPropagation();" style="padding: 3px 8px; font-size: 11px;">
              Details
            </button>
          </td>
        </tr>
      `;
    }).join('');

    // Pagination controls
    const paginationText = document.getElementById('pagination-info');
    if (paginationText) {
      paginationText.textContent = `Showing ${Math.min(startIdx + 1, sorted.length)} - ${Math.min(startIdx + pageSize, sorted.length)} of ${formatNumber(sorted.length)} transactions`;
    }

    const prevBtn = document.getElementById('page-prev');
    const nextBtn = document.getElementById('page-next');
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

    const pageDisplay = document.getElementById('page-current-display');
    if (pageDisplay) pageDisplay.textContent = `Page ${currentPage} of ${totalPages}`;

    // Add click event on rows to open detail drawer
    tableBody.querySelectorAll('tr').forEach(row => {
      row.addEventListener('click', () => {
        const txId = row.getAttribute('data-txid');
        if (txId) window.viewTxDetail(txId);
      });
    });
  }

  // ================= TRANSACTION DETAIL DRAWER =================
  window.viewTxDetail = function(txId) {
    const t = transactions.find(x => x['Transaction ID'] === txId);
    if (!t) return;

    const drawer = document.getElementById('tx-detail-drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    const body = document.getElementById('drawer-content-body');
    const title = document.getElementById('drawer-tx-title');

    title.innerHTML = `Transaction: <span style="color: var(--volopay-purple); font-weight: 800;">${t['Transaction ID']}</span>`;

    const vMaster = vendorMap[t['Vendor ID']] || {};
    const eMaster = employeeMap[t['Employee ID']] || {};

    body.innerHTML = `
      <div style="background: #f8f9fd; border: 1px solid var(--border-subtle); border-radius: 8px; padding: 18px; margin-bottom: 16px;">
        <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em;">Transaction Amount</div>
        <div style="font-size: 32px; font-weight: 800; color: #0f172a; margin-top: 4px; letter-spacing: -0.02em;">
          ${formatINR(t['Amount (INR)'])}
        </div>
        ${t['Currency'] !== 'INR' ? `
          <div style="font-size: 13px; color: var(--volopay-purple); margin-top: 4px; font-weight: 700;">
            Original Currency: ${t['Currency']} ${t['Original Amount']} (FX Rate: ${t['FX Rate to INR']})
          </div>
        ` : ''}
        <div style="margin-top: 12px; display: flex; gap: 6px; flex-wrap: wrap;">
          <span class="badge ${t['Transaction Status'] === 'Completed' ? 'badge-success' : 'badge-warning'}">${t['Transaction Status']}</span>
          <span class="badge ${t['Policy Compliant'] === 'Yes' ? 'badge-success' : 'badge-danger'}">Policy: ${t['Policy Compliant']}</span>
          <span class="badge ${t['Receipt Attached'] === 'Yes' ? 'badge-success' : 'badge-warning'}">Receipt: ${t['Receipt Attached']}</span>
        </div>
      </div>

      ${t['Policy Compliant'] === 'No' ? `
        <div class="alert-callout" style="margin-bottom: 16px;">
          <h4>Policy Exception: ${t['Policy Exception Reason']}</h4>
          <p>This transaction violated automated corporate finance controls. Investigated by central finance.</p>
        </div>
      ` : ''}

      <div style="font-size: 14px; font-weight: 700; color: var(--volopay-purple); margin-bottom: 8px;">Transaction Information</div>
      <div class="detail-row"><span class="detail-label">Date</span><span class="detail-value">${t['Transaction Date']}</span></div>
      <div class="detail-row"><span class="detail-label">Description</span><span class="detail-value" style="font-weight: 600; color: #0f172a;">${t['Description'] || '-'}</span></div>
      <div class="detail-row"><span class="detail-label">Spend Category</span><span class="detail-value">${t['Spend Category']}</span></div>
      <div class="detail-row"><span class="detail-label">Payment Method</span><span class="detail-value">${t['Payment Method']}</span></div>
      <div class="detail-row"><span class="detail-label">Transaction Type</span><span class="detail-value">${t['Transaction Type']}</span></div>
      <div class="detail-row"><span class="detail-label">Recurring/One-time</span><span class="detail-value">${t['Recurring / One-time']}</span></div>
      <div class="detail-row"><span class="detail-label">Project / Cost Centre</span><span class="detail-value">${t['Project / Cost Centre']}</span></div>
      <div class="detail-row"><span class="detail-label">Weekend Transaction</span><span class="detail-value">${t['Weekend Transaction']}</span></div>
      <div class="detail-row"><span class="detail-label">Invoice / Receipt ID</span><span class="detail-value" style="font-family: monospace; font-weight: 700;">${t['Invoice / Receipt ID'] || 'None (Missing)'}</span></div>
      <div class="detail-row"><span class="detail-label">Entered By</span><span class="detail-value">${t['Entered By']}</span></div>

      <div style="font-size: 14px; font-weight: 700; color: var(--volopay-purple); margin: 18px 0 8px;">Employee & Approval Workflow</div>
      <div class="detail-row"><span class="detail-label">Employee</span><span class="detail-value">${t['Employee Name']} (${t['Employee ID']})</span></div>
      <div class="detail-row"><span class="detail-label">Department</span><span class="detail-value">${t['Department']}</span></div>
      <div class="detail-row"><span class="detail-label">Role</span><span class="detail-value">${t['Role']}</span></div>
      <div class="detail-row"><span class="detail-label">Location / Site</span><span class="detail-value">${t['Location / Site']}</span></div>
      <div class="detail-row"><span class="detail-label">Reports To (Master)</span><span class="detail-value">${eMaster['Manager'] || '-'}</span></div>
      <div class="detail-row"><span class="detail-label">Approver</span><span class="detail-value">${t['Approver'] || 'N/A'}</span></div>
      <div class="detail-row"><span class="detail-label">Approval Status</span><span class="detail-value">${t['Approval Status']}</span></div>
      <div class="detail-row"><span class="detail-label">Turnaround Time</span><span class="detail-value">${t['Approval Turnaround (Hours)'] !== null ? `${t['Approval Turnaround (Hours)']} Hours` : '-'}</span></div>

      <div style="font-size: 14px; font-weight: 700; color: var(--volopay-purple); margin: 18px 0 8px;">Vendor & Master Data</div>
      <div class="detail-row"><span class="detail-label">Vendor</span><span class="detail-value">${t['Vendor Name']} (${t['Vendor ID'] || 'Ad-hoc'})</span></div>
      <div class="detail-row"><span class="detail-label">Vendor Criticality</span><span class="detail-value">${vMaster['Vendor Criticality'] || 'Standard'}</span></div>
      <div class="detail-row"><span class="detail-label">Agreed Payment Terms</span><span class="detail-value">${vMaster['Payment Terms'] || '30 days'}</span></div>
      <div class="detail-row"><span class="detail-label">Vendor Classification</span><span class="detail-value">${vMaster['Vendor Type'] || 'Domestic'}</span></div>
    `;

    drawer.classList.add('open');
    backdrop.classList.add('open');
  };

  window.closeTxDrawer = function() {
    const drawer = document.getElementById('tx-detail-drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    if (drawer) drawer.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
  };

  // Close drawer on backdrop click
  const backdrop = document.getElementById('drawer-backdrop');
  if (backdrop) backdrop.addEventListener('click', window.closeTxDrawer);

  // Tab Navigation Handling
  function setupTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        state.currentTab = targetTab;

        tabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        tabPanes.forEach(pane => {
          if (pane.id === `tab-${targetTab}`) {
            pane.style.display = 'block';
          } else {
            pane.style.display = 'none';
          }
        });

        // Trigger chart redraw when switching tabs
        const filteredTxs = getFilteredTransactions();
        renderCharts(filteredTxs);
      });
    });
  }

  // Quick Preset Filters
  function setupPresets() {
    const chips = document.querySelectorAll('.filter-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        const preset = chip.getAttribute('data-preset');
        state.filters.preset = preset;
        state.pagination.page = 1;

        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        updateDashboard();
      });
    });
  }

  // Master Dashboard Refresh
  function updateDashboard() {
    const filteredTxs = getFilteredTransactions();
    updateKPIs(filteredTxs);
    renderCharts(filteredTxs);
    renderBudgetTables(filteredTxs);
    renderForensicAudit();
    renderVendorTable(filteredTxs);
    renderApprovalsView(filteredTxs);
    renderTransactionLedger(filteredTxs);
  }

  // Setup Event Listeners
  function setupEventListeners() {
    const bindSelect = (id, stateKey) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', (e) => {
          state.filters[stateKey] = e.target.value;
          state.pagination.page = 1;
          updateDashboard();
        });
      }
    };

    bindSelect('filter-month', 'month');
    bindSelect('filter-dept', 'department');
    bindSelect('filter-loc', 'location');
    bindSelect('filter-proj', 'project');
    bindSelect('filter-cat', 'category');
    bindSelect('filter-pm', 'paymentMethod');
    bindSelect('filter-comp', 'policyCompliant');
    bindSelect('filter-rcpt', 'receiptAttached');
    bindSelect('filter-status', 'status');

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.filters.search = e.target.value;
        state.pagination.page = 1;
        updateDashboard();
      });
    }

    const resetBtn = document.getElementById('btn-reset-filters');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        state.filters = {
          month: 'all',
          department: 'all',
          location: 'all',
          project: 'all',
          category: 'all',
          paymentMethod: 'all',
          policyCompliant: 'all',
          receiptAttached: 'all',
          status: 'all',
          search: '',
          preset: 'all'
        };
        state.pagination.page = 1;

        // Reset inputs
        const selects = document.querySelectorAll('.filter-select');
        selects.forEach(s => s.value = 'all');
        if (searchInput) searchInput.value = '';

        document.querySelectorAll('.filter-chip').forEach(c => {
          if (c.getAttribute('data-preset') === 'all') c.classList.add('active');
          else c.classList.remove('active');
        });

        updateDashboard();
      });
    }

    // Pagination buttons
    const prevBtn = document.getElementById('page-prev');
    const nextBtn = document.getElementById('page-next');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (state.pagination.page > 1) {
          state.pagination.page--;
          const filteredTxs = getFilteredTransactions();
          renderTransactionLedger(filteredTxs);
        }
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        state.pagination.page++;
        const filteredTxs = getFilteredTransactions();
        renderTransactionLedger(filteredTxs);
      });
    }

    // CSV Export
    const exportBtn = document.getElementById('btn-export-csv');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const filteredTxs = getFilteredTransactions();
        if (filteredTxs.length === 0) {
          alert('No transactions to export.');
          return;
        }

        const headers = Object.keys(filteredTxs[0]);
        const csvRows = [headers.join(',')];

        filteredTxs.forEach(t => {
          const row = headers.map(h => {
            let val = t[h] === null || t[h] === undefined ? '' : String(t[h]);
            val = val.replace(/"/g, '""');
            if (val.includes(',') || val.includes('\n') || val.includes('"')) {
              val = `"${val}"`;
            }
            return val;
          });
          csvRows.push(row.join(','));
        });

        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `Northstar_Spend_Analytics_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      });
    }
  };

  // Preset Shortcut helper for CFO report links
  window.applyPreset = function(presetName) {
    state.filters.preset = presetName;
    state.pagination.page = 1;

    document.querySelectorAll('.filter-chip').forEach(c => {
      if (c.getAttribute('data-preset') === presetName) c.classList.add('active');
      else c.classList.remove('active');
    });

    // Switch to relevant tab
    if (presetName === 'forensic' || presetName === 'smurfing' || presetName === 'duplicate') {
      const forensicTabBtn = document.querySelector('[data-tab="forensic"]');
      if (forensicTabBtn) forensicTabBtn.click();
    } else {
      const txTabBtn = document.querySelector('[data-tab="ledger"]');
      if (txTabBtn) txTabBtn.click();
    }

    updateDashboard();
  };

  // Initial Run
  populateFilterOptions();
  setupTabs();
  setupPresets();
  setupEventListeners();
  updateDashboard();
});
