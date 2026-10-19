// The access rule, in one place (ADR 0010): which provider statuses include the plan's features.
// `past_due` keeps access on purpose: the provider is still retrying the payment, and it decides
// when the subscription becomes `unpaid` or `canceled`. We add no clock of our own.
const ENTITLED_STATUSES = ['active', 'trialing', 'past_due']

export function isEntitled(status: string): boolean {
  return ENTITLED_STATUSES.includes(status)
}
