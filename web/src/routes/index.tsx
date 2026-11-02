import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

export const Route = createFileRoute('/')({
  component: App,
})

interface HomeItem {
  id: string
  name: string
  createdAt?: string
}

interface MemberItem {
  id: string
  homeId: string
  name: string
  position: number
}

interface ShareItem {
  id: string
  billId: string
  memberId: string
  memberName?: string
  amountCents: number
  paidAt: string | null
}

interface BillItem {
  id: string
  homeId: string
  title: string
  totalCents: number
  createdAt: string
  shares: ShareItem[]
}

interface BalanceItem {
  memberId: string
  name: string
  outstandingCents: number
}

function formatCents(cents: number): string {
  const dollars = (cents / 100).toFixed(2)
  return `$${dollars} (${cents}¢)`
}

function App() {
  const [homes, setHomes] = useState<HomeItem[]>([])
  const [selectedHomeId, setSelectedHomeId] = useState<string>('')
  const [bills, setBills] = useState<BillItem[]>([])
  const [balances, setBalances] = useState<BalanceItem[]>([])
  const [members, setMembers] = useState<MemberItem[]>([])

  const [isLoadingHomes, setIsLoadingHomes] = useState(true)
  const [isLoadingBills, setIsLoadingBills] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [paymentErrors, setPaymentErrors] = useState<Record<string, string>>({})
  const [isPaying, setIsPaying] = useState<Record<string, boolean>>({})

  // Form states
  const [newHomeName, setNewHomeName] = useState('')
  const [isCreatingHome, setIsCreatingHome] = useState(false)

  const [newMemberName, setNewMemberName] = useState('')
  const [isAddingMember, setIsAddingMember] = useState(false)

  const [newBillTitle, setNewBillTitle] = useState('')
  const [newBillAmount, setNewBillAmount] = useState('')
  const [isCreatingBill, setIsCreatingBill] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Fetch all homes
  const fetchHomes = useCallback(async () => {
    setIsLoadingHomes(true)
    setPageError(null)
    try {
      const res = await fetch('/api/homes')
      if (!res.ok) {
        const errJson = await res.json().catch(() => null)
        throw new Error(errJson?.error || `HTTP ${res.status}: Failed to load homes`)
      }
      const data = await res.json()
      const list: HomeItem[] = data.homes || []
      setHomes(list)
      if (list.length > 0 && !selectedHomeId) {
        setSelectedHomeId(list[0]?.id ?? '')
      }
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : 'Failed to connect to API')
    } finally {
      setIsLoadingHomes(false)
    }
  }, [selectedHomeId])

  // Fetch bills, balances, and members for the selected home
  const fetchHomeData = useCallback(async (homeId: string) => {
    if (!homeId) return
    setIsLoadingBills(true)
    setPageError(null)

    try {
      const [billsRes, balancesRes, membersRes] = await Promise.all([
        fetch(`/api/homes/${homeId}/bills`),
        fetch(`/api/homes/${homeId}/balances`),
        fetch(`/api/homes/${homeId}/members`),
      ])

      if (!billsRes.ok) {
        const err = await billsRes.json().catch(() => null)
        throw new Error(err?.error || `Failed to fetch bills (${billsRes.status})`)
      }
      const billsData = await billsRes.json()
      setBills(billsData.bills || [])

      if (balancesRes.ok) {
        const balData = await balancesRes.json()
        setBalances(balData.balances || [])
      }

      if (membersRes.ok) {
        const memData = await membersRes.json()
        setMembers(memData.members || [])
      }
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : 'Failed to load home details')
    } finally {
      setIsLoadingBills(false)
    }
  }, [])

  useEffect(() => {
    fetchHomes()
  }, [fetchHomes])

  useEffect(() => {
    if (selectedHomeId) {
      fetchHomeData(selectedHomeId)
    }
  }, [selectedHomeId, fetchHomeData])

  // Create Home
  const handleCreateHome = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newHomeName.trim()) return
    setIsCreatingHome(true)
    setFormError(null)

    try {
      const res = await fetch('/api/homes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newHomeName.trim() }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to create home')
      }
      setNewHomeName('')
      setHomes((prev) => [data, ...prev])
      setSelectedHomeId(data.id)
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Error creating home')
    } finally {
      setIsCreatingHome(false)
    }
  }

  // Add Member
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMemberName.trim() || !selectedHomeId) return
    setIsAddingMember(true)
    setFormError(null)

    try {
      const res = await fetch(`/api/homes/${selectedHomeId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newMemberName.trim() }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to add member')
      }
      setNewMemberName('')
      await fetchHomeData(selectedHomeId)
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Error adding member')
    } finally {
      setIsAddingMember(false)
    }
  }

  // Create Bill
  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newBillTitle.trim() || !newBillAmount || !selectedHomeId) return
    setIsCreatingBill(true)
    setFormError(null)

    const parsedCents = Math.round(Number(newBillAmount) * 100)
    if (Number.isNaN(parsedCents) || parsedCents <= 0) {
      setFormError('Please enter a positive whole number of cents or dollar amount')
      setIsCreatingBill(false)
      return
    }

    try {
      const res = await fetch(`/api/homes/${selectedHomeId}/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newBillTitle.trim(),
          totalCents: parsedCents,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to create bill')
      }
      setNewBillTitle('')
      setNewBillAmount('')
      await fetchHomeData(selectedHomeId)
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Error creating bill')
    } finally {
      setIsCreatingBill(false)
    }
  }

  // Pay Share
  const handlePayShare = async (billId: string, shareId: string) => {
    setIsPaying((prev) => ({ ...prev, [shareId]: true }))
    setPaymentErrors((prev) => {
      const copy = { ...prev }
      delete copy[shareId]
      return copy
    })

    const idempotencyKey = crypto.randomUUID()

    try {
      const res = await fetch(`/api/bills/${billId}/shares/${shareId}/pay`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        // Keep unpaid state, display clear error message
        const errMsg = data?.error || `Payment failed (${res.status})`
        setPaymentErrors((prev) => ({ ...prev, [shareId]: errMsg }))
        return
      }

      // Successful payment: refresh bills and balances
      await fetchHomeData(selectedHomeId)
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Network error during payment'
      setPaymentErrors((prev) => ({ ...prev, [shareId]: errMsg }))
    } finally {
      setIsPaying((prev) => ({ ...prev, [shareId]: false }))
    }
  }

  const selectedHome = homes.find((h) => h.id === selectedHomeId)

  return (
    <div style={styles.container}>
      {/* Top Header */}
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Shared Bill Splitter</h1>
          <p style={styles.subtitle}>
            Fairly divide household bills with automatic cent distribution
          </p>
        </div>
      </header>

      {/* Global Error Alert */}
      {pageError && (
        <div style={styles.errorBanner} role="alert">
          <div style={styles.errorContent}>
            <strong>Error:</strong> {pageError}
          </div>
          <button
            type="button"
            style={styles.retryButton}
            onClick={() => (selectedHomeId ? fetchHomeData(selectedHomeId) : fetchHomes())}
          >
            Retry
          </button>
        </div>
      )}

      {/* Home Selector Bar */}
      <section style={styles.card}>
        <div style={styles.homeBar}>
          <div style={{ flex: 1, minWidth: '220px' }}>
            <label htmlFor="home-select" style={styles.label}>
              Select Household:
            </label>
            {isLoadingHomes ? (
              <div style={styles.loadingText}>Loading homes...</div>
            ) : homes.length === 0 ? (
              <div style={styles.emptyNotice}>No homes created yet. Create one below!</div>
            ) : (
              <select
                id="home-select"
                style={styles.select}
                value={selectedHomeId}
                onChange={(e) => setSelectedHomeId(e.target.value)}
              >
                {homes.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Quick Create Home Form */}
          <form onSubmit={handleCreateHome} style={styles.inlineForm}>
            <input
              type="text"
              placeholder="New home name (e.g. Flat 4B)"
              value={newHomeName}
              onChange={(e) => setNewHomeName(e.target.value)}
              style={styles.input}
              disabled={isCreatingHome}
            />
            <button
              type="submit"
              disabled={isCreatingHome || !newHomeName.trim()}
              style={styles.primaryButton}
            >
              {isCreatingHome ? 'Creating...' : '+ Create Home'}
            </button>
          </form>
        </div>

        {formError && <div style={styles.formErrorText}>{formError}</div>}
      </section>

      {selectedHome && (
        <div style={styles.mainLayout}>
          {/* Left Column: Management & Balances */}
          <aside style={styles.sidebar}>
            {/* Balances Card */}
            <div style={styles.card}>
              <h2 style={styles.sectionHeading}>Outstanding Balances</h2>
              <p style={styles.helpText}>Calculated across all unpaid bills in order added</p>

              {balances.length === 0 ? (
                <div style={styles.emptyStateNotice}>No members added yet.</div>
              ) : (
                <ul style={styles.balanceList}>
                  {balances.map((b) => (
                    <li key={b.memberId} style={styles.balanceItem}>
                      <span style={styles.memberName}>{b.name}</span>
                      <span
                        style={{
                          ...styles.balanceAmount,
                          color: b.outstandingCents > 0 ? '#b45309' : '#15803d',
                        }}
                      >
                        {formatCents(b.outstandingCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Add Member Card */}
            <div style={styles.card}>
              <h2 style={styles.sectionHeading}>Add Home Member</h2>
              <p style={styles.helpText}>Order of insertion determines remaining cent splits</p>
              <form onSubmit={handleAddMember} style={styles.columnForm}>
                <input
                  type="text"
                  placeholder="Member name (e.g. Asha)"
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  style={styles.input}
                  disabled={isAddingMember}
                />
                <button
                  type="submit"
                  disabled={isAddingMember || !newMemberName.trim()}
                  style={styles.secondaryButton}
                >
                  {isAddingMember ? 'Adding...' : '+ Add Member'}
                </button>
              </form>
            </div>

            {/* Create Bill Card */}
            <div style={styles.card}>
              <h2 style={styles.sectionHeading}>Add a Bill</h2>
              <p style={styles.helpText}>Split evenly among all members in this home</p>
              <form onSubmit={handleCreateBill} style={styles.columnForm}>
                <input
                  type="text"
                  placeholder="Bill title (e.g. Electricity)"
                  value={newBillTitle}
                  onChange={(e) => setNewBillTitle(e.target.value)}
                  style={styles.input}
                  disabled={isCreatingBill}
                />
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="Amount in $ (e.g. 30.00)"
                  value={newBillAmount}
                  onChange={(e) => setNewBillAmount(e.target.value)}
                  style={styles.input}
                  disabled={isCreatingBill}
                />
                <button
                  type="submit"
                  disabled={
                    isCreatingBill || !newBillTitle.trim() || !newBillAmount || members.length === 0
                  }
                  style={styles.primaryButton}
                >
                  {isCreatingBill ? 'Splitting...' : 'Split Bill'}
                </button>
                {members.length === 0 && (
                  <span style={styles.warningNote}>Add at least 1 member first</span>
                )}
              </form>
            </div>
          </aside>

          {/* Right Column: Bills and Shares */}
          <main style={styles.content}>
            <div style={styles.contentHeader}>
              <h2 style={styles.sectionHeading}>Bills for {selectedHome.name}</h2>
              <button
                type="button"
                style={styles.refreshButton}
                onClick={() => fetchHomeData(selectedHomeId)}
                disabled={isLoadingBills}
              >
                {isLoadingBills ? 'Refreshing...' : '↻ Refresh'}
              </button>
            </div>

            {/* Loading State */}
            {isLoadingBills && (
              <div style={styles.loadingBox}>
                <div style={styles.spinner} />
                <p style={{ marginTop: 12, color: '#4b5563' }}>Loading bills and shares...</p>
              </div>
            )}

            {/* Empty State */}
            {!isLoadingBills && bills.length === 0 && (
              <div style={styles.emptyBox}>
                <div style={styles.emptyIcon}>📋</div>
                <h3 style={styles.emptyTitle}>No bills recorded yet</h3>
                <p style={styles.emptyText}>
                  Use the "Add a Bill" form on the left to create and split your first household
                  expense.
                </p>
              </div>
            )}

            {/* Bills List */}
            {!isLoadingBills &&
              bills.map((bill) => (
                <article key={bill.id} style={styles.billCard}>
                  <div style={styles.billHeader}>
                    <div>
                      <h3 style={styles.billTitle}>{bill.title}</h3>
                      <span style={styles.billDate}>
                        Created: {new Date(bill.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div style={styles.totalBadge}>
                      Total: <strong>{formatCents(bill.totalCents)}</strong>
                    </div>
                  </div>

                  {/* Shares Breakdown */}
                  <div style={styles.sharesContainer}>
                    <h4 style={styles.sharesHeading}>Member Shares:</h4>
                    <div style={styles.sharesList}>
                      {bill.shares.map((share) => {
                        const isSharePaying = isPaying[share.id] || false
                        const shareError = paymentErrors[share.id]
                        const isPaid = share.paidAt !== null

                        return (
                          <div
                            key={share.id}
                            style={{
                              ...styles.shareRow,
                              backgroundColor: isPaid ? '#f0fdf4' : '#fffbeb',
                              borderColor: isPaid ? '#bbf7d0' : '#fde68a',
                            }}
                          >
                            <div style={styles.shareInfo}>
                              <span style={styles.shareMember}>{share.memberName || 'Member'}</span>
                              <span style={styles.shareAmount}>
                                {formatCents(share.amountCents)}
                              </span>
                            </div>

                            <div style={styles.shareActions}>
                              {isPaid ? (
                                <span style={styles.paidBadge}>
                                  ✓ Paid ({new Date(share.paidAt as string).toLocaleTimeString()})
                                </span>
                              ) : (
                                <div style={styles.unpaidContainer}>
                                  <span style={styles.unpaidBadge}>Unpaid</span>
                                  <button
                                    type="button"
                                    onClick={() => handlePayShare(bill.id, share.id)}
                                    disabled={isSharePaying}
                                    style={{
                                      ...styles.payButton,
                                      opacity: isSharePaying ? 0.6 : 1,
                                    }}
                                  >
                                    {isSharePaying ? 'Processing...' : 'Pay Share'}
                                  </button>
                                </div>
                              )}
                            </div>

                            {/* Payment Error for this share */}
                            {shareError && (
                              <div style={styles.shareErrorBanner} role="alert">
                                <strong>Payment error:</strong> {shareError}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </article>
              ))}
          </main>
        </div>
      )}
    </div>
  )
}

// Inline CSS Styles for complete styling without extra CSS dependencies
const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '24px 16px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif',
    color: '#1f2937',
    backgroundColor: '#f9fafb',
    minHeight: '100vh',
  },
  header: {
    marginBottom: '24px',
    paddingBottom: '16px',
    borderBottom: '1px solid #e5e7eb',
  },
  title: {
    margin: 0,
    fontSize: '28px',
    fontWeight: 700,
    color: '#111827',
  },
  subtitle: {
    margin: '4px 0 0 0',
    color: '#6b7280',
    fontSize: '15px',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: '10px',
    border: '1px solid #e5e7eb',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
    padding: '20px',
    marginBottom: '20px',
  },
  homeBar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '16px',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: 600,
    marginBottom: '6px',
    color: '#374151',
  },
  select: {
    width: '100%',
    padding: '8px 12px',
    fontSize: '15px',
    borderRadius: '6px',
    border: '1px solid #d1d5db',
    backgroundColor: '#ffffff',
    outline: 'none',
  },
  inlineForm: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  columnForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    marginTop: '12px',
  },
  input: {
    padding: '8px 12px',
    fontSize: '14px',
    borderRadius: '6px',
    border: '1px solid #d1d5db',
    outline: 'none',
  },
  primaryButton: {
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: 600,
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#2563eb',
    color: '#ffffff',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  secondaryButton: {
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: 600,
    borderRadius: '6px',
    border: '1px solid #d1d5db',
    backgroundColor: '#f3f4f6',
    color: '#374151',
    cursor: 'pointer',
  },
  refreshButton: {
    padding: '6px 12px',
    fontSize: '13px',
    fontWeight: 500,
    borderRadius: '6px',
    border: '1px solid #d1d5db',
    backgroundColor: '#ffffff',
    color: '#4b5563',
    cursor: 'pointer',
  },
  payButton: {
    padding: '6px 14px',
    fontSize: '13px',
    fontWeight: 600,
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#16a34a',
    color: '#ffffff',
    cursor: 'pointer',
  },
  errorBanner: {
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '8px',
    padding: '12px 16px',
    marginBottom: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    color: '#991b1b',
  },
  errorContent: {
    fontSize: '14px',
  },
  retryButton: {
    padding: '4px 10px',
    fontSize: '12px',
    fontWeight: 600,
    borderRadius: '4px',
    border: '1px solid #dc2626',
    backgroundColor: '#ffffff',
    color: '#dc2626',
    cursor: 'pointer',
  },
  formErrorText: {
    marginTop: '10px',
    color: '#dc2626',
    fontSize: '13px',
    fontWeight: 500,
  },
  loadingText: {
    color: '#6b7280',
    fontSize: '14px',
  },
  emptyNotice: {
    color: '#9ca3af',
    fontSize: '14px',
    fontStyle: 'italic',
  },
  mainLayout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(280px, 340px) 1fr',
    gap: '24px',
    alignItems: 'start',
  },
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  content: {
    minWidth: 0,
  },
  contentHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '16px',
  },
  sectionHeading: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 700,
    color: '#111827',
  },
  helpText: {
    margin: '4px 0 0 0',
    fontSize: '13px',
    color: '#6b7280',
  },
  warningNote: {
    fontSize: '12px',
    color: '#b45309',
  },
  balanceList: {
    listStyle: 'none',
    margin: '12px 0 0 0',
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  balanceItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 10px',
    borderRadius: '6px',
    backgroundColor: '#f9fafb',
    fontSize: '14px',
  },
  memberName: {
    fontWeight: 600,
    color: '#374151',
  },
  balanceAmount: {
    fontWeight: 700,
  },
  emptyStateNotice: {
    marginTop: '12px',
    color: '#9ca3af',
    fontSize: '13px',
    fontStyle: 'italic',
  },
  loadingBox: {
    padding: '48px 24px',
    textAlign: 'center',
    backgroundColor: '#ffffff',
    borderRadius: '10px',
    border: '1px solid #e5e7eb',
  },
  spinner: {
    width: '32px',
    height: '32px',
    margin: '0 auto',
    borderRadius: '50%',
    border: '3px solid #e5e7eb',
    borderTopColor: '#2563eb',
    animation: 'spin 1s linear infinite',
  },
  emptyBox: {
    padding: '48px 24px',
    textAlign: 'center',
    backgroundColor: '#ffffff',
    borderRadius: '10px',
    border: '1px dashed #d1d5db',
  },
  emptyIcon: {
    fontSize: '36px',
    marginBottom: '12px',
  },
  emptyTitle: {
    margin: '0 0 8px 0',
    fontSize: '18px',
    fontWeight: 600,
    color: '#111827',
  },
  emptyText: {
    margin: 0,
    fontSize: '14px',
    color: '#6b7280',
    maxWidth: '380px',
    marginLeft: 'auto',
    marginRight: 'auto',
  },
  billCard: {
    backgroundColor: '#ffffff',
    borderRadius: '10px',
    border: '1px solid #e5e7eb',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
    padding: '20px',
    marginBottom: '16px',
  },
  billHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: '12px',
    borderBottom: '1px solid #f3f4f6',
  },
  billTitle: {
    margin: '0 0 4px 0',
    fontSize: '17px',
    fontWeight: 700,
    color: '#111827',
  },
  billDate: {
    fontSize: '12px',
    color: '#9ca3af',
  },
  totalBadge: {
    backgroundColor: '#eff6ff',
    color: '#1e40af',
    padding: '6px 12px',
    borderRadius: '6px',
    fontSize: '14px',
  },
  sharesContainer: {
    marginTop: '14px',
  },
  sharesHeading: {
    margin: '0 0 8px 0',
    fontSize: '13px',
    fontWeight: 600,
    color: '#4b5563',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  sharesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  shareRow: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px',
    borderRadius: '8px',
    border: '1px solid',
    gap: '8px',
  },
  shareInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  shareMember: {
    fontWeight: 600,
    color: '#1f2937',
    fontSize: '14px',
  },
  shareAmount: {
    fontSize: '14px',
    color: '#4b5563',
  },
  shareActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  unpaidContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  paidBadge: {
    backgroundColor: '#dcfce7',
    color: '#15803d',
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 600,
  },
  unpaidBadge: {
    backgroundColor: '#fef3c7',
    color: '#92400e',
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 600,
  },
  shareErrorBanner: {
    width: '100%',
    padding: '6px 10px',
    borderRadius: '4px',
    backgroundColor: '#fee2e2',
    color: '#b91c1c',
    fontSize: '12px',
  },
}
