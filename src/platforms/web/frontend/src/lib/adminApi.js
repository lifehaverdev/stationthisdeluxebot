/**
 * Admin API calls — all require wallet address for auth.
 */

export async function fetchVaultBalances(wallet) {
  const res = await fetch(`/api/v1/admin/vaults/vault-balances?wallet=${wallet}&chainId=1`);
  if (!res.ok) throw new Error('Failed to fetch balances');
  return res.json();
}

export async function fetchWithdrawalRequests(wallet) {
  const res = await fetch(`/api/v1/admin/vaults/withdrawal-requests?wallet=${wallet}&status=PENDING_PROCESSING`);
  if (!res.ok) return { requests: [] };
  return res.json();
}

export async function fetchAccounts(wallet) {
  const res = await fetch(`/api/v1/admin/vaults/accounts?wallet=${wallet}&chainId=1`);
  if (!res.ok) return { accounts: [] };
  return res.json();
}

export async function fetchFreePoints(wallet) {
  const res = await fetch(`/api/v1/admin/vaults/free-points?wallet=${wallet}&chainId=1`);
  if (!res.ok) return null;
  return res.json();
}

export async function fetchAnalytics(wallet, dateRange) {
  const params = new URLSearchParams({
    wallet,
    chainId: '1',
    period: dateRange.period,
    startDate: dateRange.startDate.toISOString(),
    endDate: dateRange.endDate.toISOString()
  });
  const res = await fetch(`/api/v1/admin/vaults/analytics/usage?${params}`);
  if (!res.ok) return null;
  return res.json();
}

export async function fetchWithdrawalAnalytics(wallet, dateRange) {
  const params = new URLSearchParams({
    wallet,
    chainId: '1',
    period: dateRange.period,
    startDate: dateRange.startDate.toISOString(),
    endDate: dateRange.endDate.toISOString()
  });
  const res = await fetch(`/api/v1/admin/vaults/analytics/withdrawals?${params}`);
  if (!res.ok) return null;
  return res.json();
}

export async function fetchRankings(wallet, dateRange, sortBy = 'usage') {
  const params = new URLSearchParams({
    wallet,
    chainId: '1',
    startDate: dateRange.startDate.toISOString(),
    endDate: dateRange.endDate.toISOString(),
    sortBy,
    limit: '50'
  });
  const res = await fetch(`/api/v1/admin/vaults/analytics/rankings?${params}`);
  if (!res.ok) return null;
  return res.json();
}

export async function fetchActiveUsers(wallet, dateRange, sortBy = 'points') {
  const params = new URLSearchParams({
    wallet,
    chainId: '1',
    startDate: dateRange.startDate.toISOString(),
    endDate: dateRange.endDate.toISOString(),
    sortBy,
    limit: '50'
  });
  const res = await fetch(`/api/v1/admin/vaults/analytics/active-users?${params}`);
  if (!res.ok) return null;
  return res.json();
}

export async function fetchAccounting(wallet, period = 'mtd', dateRange) {
  const params = new URLSearchParams({ wallet, chainId: '1', period });
  if (period === 'custom' && dateRange) {
    params.append('startDate', dateRange.startDate.toISOString());
    params.append('endDate', dateRange.endDate.toISOString());
  }
  const res = await fetch(`/api/v1/admin/vaults/analytics/accounting?${params}`);
  if (!res.ok) return null;
  return res.json();
}

export async function fetchCosts(wallet) {
  const res = await fetch(`/api/v1/admin/vaults/costs?wallet=${wallet}&limit=50`);
  if (!res.ok) return { costs: [] };
  return res.json();
}

export async function fetchCostTotals(wallet) {
  const res = await fetch(`/api/v1/admin/vaults/costs/totals/by-category?wallet=${wallet}`);
  if (!res.ok) return { totals: [] };
  return res.json();
}

export async function submitCostEntry(wallet, data) {
  const res = await fetch(`/api/v1/admin/vaults/costs?wallet=${wallet}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Failed to add cost entry');
  }
  return res.json();
}

export async function fetchPendingDeposits(wallet, filters = {}) {
  const params = new URLSearchParams({ wallet, chainId: '1' });
  if (filters.statuses?.length) params.set('statuses', filters.statuses.join(','));
  if (filters.token) params.set('token', filters.token.trim());
  const res = await fetch(`/api/v1/admin/vaults/deposits/pending?${params}`);
  if (!res.ok) throw new Error('Failed to fetch pending deposits');
  return res.json();
}

export async function searchUsers(wallet, query, type = '') {
  const res = await fetch(`/api/v1/admin/vaults/users/search?query=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}&wallet=${wallet}`);
  if (!res.ok) throw new Error('Search failed');
  return res.json();
}

export async function fetchUserDetails(wallet, masterAccountId) {
  const res = await fetch(`/api/v1/admin/vaults/users/${masterAccountId}?wallet=${wallet}`);
  if (!res.ok) throw new Error('Failed to load user details');
  return res.json();
}

export async function adjustUserPoints(wallet, masterAccountId, data) {
  const res = await fetch(`/api/v1/admin/vaults/users/${masterAccountId}/adjust-points?wallet=${wallet}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Failed to adjust points');
  }
  return res.json();
}

export async function saveUserNotes(wallet, masterAccountId, data) {
  const res = await fetch(`/api/v1/admin/vaults/users/${masterAccountId}/notes?wallet=${wallet}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to save notes');
  return res.json();
}
