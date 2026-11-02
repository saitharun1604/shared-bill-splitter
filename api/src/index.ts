import { Hono } from 'hono'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) => c.json({ status: 'ok' }))

// Part 1: Homes & Members
app.post('/api/homes', async (c) => {
  const body = await c.req.json<{ name?: unknown }>().catch(() => null)
  if (!body || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return c.json({ error: 'Name is required' }, 400)
  }

  const id = crypto.randomUUID()
  const name = body.name.trim()

  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()

  return c.json({ id, name }, 201)
})

app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const body = await c.req.json<{ name?: unknown }>().catch(() => null)
  if (!body || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return c.json({ error: 'Name is required' }, 400)
  }

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const id = crypto.randomUUID()
  const name = body.name.trim()

  await c.env.DB.prepare(`
    INSERT INTO members (id, home_id, name, position)
    VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM members WHERE home_id = ?))
  `)
    .bind(id, homeId, name, homeId)
    .run()

  return c.json({ id, homeId, name }, 201)
})

// Part 2: Bill splitting & payments
app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const body = await c.req.json<{ title?: unknown; totalCents?: unknown }>().catch(() => null)

  if (
    !body ||
    typeof body.totalCents !== 'number' ||
    !Number.isInteger(body.totalCents) ||
    body.totalCents <= 0
  ) {
    return c.json({ error: 'totalCents must be a positive integer' }, 422)
  }

  if (typeof body.title !== 'string' || body.title.trim().length === 0) {
    return c.json({ error: 'Title is required' }, 400)
  }

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const { results: members } = await c.env.DB.prepare(
    'SELECT id FROM members WHERE home_id = ? ORDER BY position ASC',
  )
    .bind(homeId)
    .all<{ id: string }>()

  if (!members || members.length === 0) {
    return c.json({ error: 'Home has no members' }, 422)
  }

  const totalCents = body.totalCents
  const n = members.length
  const baseAmount = Math.floor(totalCents / n)
  const remainder = totalCents % n

  const billId = crypto.randomUUID()
  const shares = members.map((member, i) => ({
    id: crypto.randomUUID(),
    memberId: member.id,
    amountCents: baseAmount + (i < remainder ? 1 : 0),
    paidAt: null as string | null,
  }))

  const statements = [
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    ).bind(billId, homeId, body.title.trim(), totalCents),
    ...shares.map((share) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents, paid_at) VALUES (?, ?, ?, ?, NULL)',
      ).bind(share.id, billId, share.memberId, share.amountCents),
    ),
  ]

  await c.env.DB.batch(statements)

  return c.json(
    {
      id: billId,
      homeId,
      title: body.title.trim(),
      totalCents,
      shares,
    },
    201,
  )
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')
  const idempotencyKey = c.req.header('Idempotency-Key')

  if (!idempotencyKey || idempotencyKey.trim().length === 0) {
    return c.json({ error: 'Idempotency-Key header is required' }, 400)
  }
  const key = idempotencyKey.trim()

  const bill = await c.env.DB.prepare('SELECT id FROM bills WHERE id = ?').bind(billId).first()
  if (!bill) {
    return c.json({ error: 'Bill not found' }, 404)
  }

  const share = await c.env.DB.prepare(
    'SELECT id, member_id, amount_cents, paid_at FROM shares WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<{ id: string; member_id: string; amount_cents: number; paid_at: string | null }>()

  if (!share) {
    return c.json({ error: 'Share not found' }, 404)
  }

  // Check if a payment for this share already exists
  const existingPayment = await c.env.DB.prepare(
    'SELECT idempotency_key, created_at FROM payments WHERE share_id = ?',
  )
    .bind(shareId)
    .first<{ idempotency_key: string; created_at: string }>()

  if (existingPayment) {
    if (existingPayment.idempotency_key === key) {
      return c.json(
        {
          id: share.id,
          memberId: share.member_id,
          amountCents: share.amount_cents,
          paidAt: share.paid_at || existingPayment.created_at,
        },
        200,
      )
    }
    return c.json({ error: 'Share already paid with a different key' }, 409)
  }

  const paymentId = crypto.randomUUID()
  const paidAt = new Date().toISOString()

  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO payments (id, share_id, idempotency_key, created_at) VALUES (?, ?, ?, ?)',
      ).bind(paymentId, shareId, key, paidAt),
      c.env.DB.prepare('UPDATE shares SET paid_at = ? WHERE id = ?').bind(paidAt, shareId),
    ])

    return c.json(
      {
        id: share.id,
        memberId: share.member_id,
        amountCents: share.amount_cents,
        paidAt,
      },
      200,
    )
  } catch {
    // Handle race condition: check if another concurrent request completed the payment
    const paymentAfterRace = await c.env.DB.prepare(
      'SELECT idempotency_key, created_at FROM payments WHERE share_id = ?',
    )
      .bind(shareId)
      .first<{ idempotency_key: string; created_at: string }>()

    if (paymentAfterRace) {
      if (paymentAfterRace.idempotency_key === key) {
        const updatedShare = await c.env.DB.prepare('SELECT paid_at FROM shares WHERE id = ?')
          .bind(shareId)
          .first<{ paid_at: string }>()
        return c.json(
          {
            id: share.id,
            memberId: share.member_id,
            amountCents: share.amount_cents,
            paidAt: updatedShare?.paid_at || paymentAfterRace.created_at,
          },
          200,
        )
      }
      return c.json({ error: 'Share already paid with a different key' }, 409)
    }
    return c.json({ error: 'Failed to process payment' }, 500)
  }
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const balancesQuery = `
    SELECT
      m.id AS memberId,
      m.name AS name,
      COALESCE((
        SELECT SUM(s.amount_cents)
        FROM shares s
        JOIN bills b ON b.id = s.bill_id
        WHERE s.member_id = m.id
          AND b.home_id = m.home_id
          AND s.paid_at IS NULL
      ), 0) AS outstandingCents
    FROM members m
    WHERE m.home_id = ?
    ORDER BY m.position ASC
  `

  const { results } = await c.env.DB.prepare(balancesQuery)
    .bind(homeId)
    .all<{ memberId: string; name: string; outstandingCents: number }>()

  return c.json(
    {
      balances: (results ?? []).map((row) => ({
        memberId: row.memberId,
        name: row.name,
        outstandingCents: Number(row.outstandingCents),
      })),
    },
    200,
  )
})

app.get('/api/homes', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, created_at AS createdAt FROM homes ORDER BY created_at DESC',
  ).all<{ id: string; name: string; createdAt: string }>()
  return c.json({ homes: results ?? [] }, 200)
})

app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const { results: bills } = await c.env.DB.prepare(
    'SELECT id, home_id AS homeId, title, total_cents AS totalCents, created_at AS createdAt FROM bills WHERE home_id = ? ORDER BY created_at DESC',
  )
    .bind(homeId)
    .all<{ id: string; homeId: string; title: string; totalCents: number; createdAt: string }>()

  const { results: shares } = await c.env.DB.prepare(`
    SELECT
      s.id,
      s.bill_id AS billId,
      s.member_id AS memberId,
      m.name AS memberName,
      s.amount_cents AS amountCents,
      s.paid_at AS paidAt
    FROM shares s
    JOIN bills b ON b.id = s.bill_id
    JOIN members m ON m.id = s.member_id
    WHERE b.home_id = ?
    ORDER BY m.position ASC
  `)
    .bind(homeId)
    .all<{
      id: string
      billId: string
      memberId: string
      memberName: string
      amountCents: number
      paidAt: string | null
    }>()

  const billsWithShares = (bills ?? []).map((bill) => ({
    ...bill,
    shares: (shares ?? []).filter((s) => s.billId === bill.id),
  }))

  return c.json({ bills: billsWithShares }, 200)
})

app.get('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }
  const { results } = await c.env.DB.prepare(
    'SELECT id, home_id AS homeId, name, position FROM members WHERE home_id = ? ORDER BY position ASC',
  )
    .bind(homeId)
    .all<{ id: string; homeId: string; name: string; position: number }>()
  return c.json({ members: results ?? [] }, 200)
})

app.get('/api/homes', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, created_at AS createdAt FROM homes ORDER BY created_at DESC',
  ).all<{ id: string; name: string; createdAt: string }>()
  return c.json({ homes: results ?? [] }, 200)
})

app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const { results: bills } = await c.env.DB.prepare(
    'SELECT id, home_id AS homeId, title, total_cents AS totalCents, created_at AS createdAt FROM bills WHERE home_id = ? ORDER BY created_at DESC',
  )
    .bind(homeId)
    .all<{ id: string; homeId: string; title: string; totalCents: number; createdAt: string }>()

  const { results: shares } = await c.env.DB.prepare(`
    SELECT
      s.id,
      s.bill_id AS billId,
      s.member_id AS memberId,
      m.name AS memberName,
      s.amount_cents AS amountCents,
      s.paid_at AS paidAt
    FROM shares s
    JOIN bills b ON b.id = s.bill_id
    JOIN members m ON m.id = s.member_id
    WHERE b.home_id = ?
    ORDER BY m.position ASC
  `)
    .bind(homeId)
    .all<{
      id: string
      billId: string
      memberId: string
      memberName: string
      amountCents: number
      paidAt: string | null
    }>()

  const billsWithShares = (bills ?? []).map((bill) => ({
    ...bill,
    shares: (shares ?? []).filter((s) => s.billId === bill.id),
  }))

  return c.json({ bills: billsWithShares }, 200)
})

app.get('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }
  const { results } = await c.env.DB.prepare(
    'SELECT id, home_id AS homeId, name, position FROM members WHERE home_id = ? ORDER BY position ASC',
  )
    .bind(homeId)
    .all<{ id: string; homeId: string; name: string; position: number }>()
  return c.json({ members: results ?? [] }, 200)
})

export default app
