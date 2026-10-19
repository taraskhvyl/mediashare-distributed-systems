// The hosted checkout page the browser is sent to (like checkout.stripe.com), with three buttons.
import type { FastifyInstance } from 'fastify'
import { startSubscription } from './lifecycle.js'
import { findCheckoutSession } from './state.js'

const PAGE_STYLE = 'font-family:system-ui;max-width:28rem;margin:4rem auto;padding:0 1rem'
const BUTTON_STYLE = 'padding:.6rem 1rem;margin-right:.5rem;font-size:1rem;cursor:pointer'

export async function checkoutPageRoutes(app: FastifyInstance) {
  // A <form method=post> sends urlencoded data; we have no fields, so the body is ignored.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) =>
    done(null, body),
  )

  app.get('/checkout/:id', async (req, reply) => {
    const session = findCheckoutSession((req.params as { id: string }).id)
    if (!session) return reply.code(404).type('text/html').send('<p>Unknown checkout session</p>')
    const button = (action: string, label: string) =>
      `<form method="post" action="/checkout/${session.id}/${action}" style="display:inline"><button style="${BUTTON_STYLE}">${label}</button></form>`
    return reply.type('text/html').send(`<!doctype html><title>Fake payments</title>
<body style="${PAGE_STYLE}"><h1>Fake payments</h1>
<p>Subscribe to <b>${session.plan}</b> (test checkout, no money moves).</p>
${button('pay', 'Pay')} ${button('cancel', 'Cancel')}</body>`)
  })

  app.post('/checkout/:id/pay', async (req, reply) => {
    const session = findCheckoutSession((req.params as { id: string }).id)
    if (!session) return reply.code(404).send()
    startSubscription(session.userId, session.plan)
    return reply.redirect(session.successUrl, 303)
  })

  app.post('/checkout/:id/cancel', async (req, reply) => {
    const session = findCheckoutSession((req.params as { id: string }).id)
    if (!session) return reply.code(404).send()
    return reply.redirect(session.cancelUrl, 303)
  })
}
