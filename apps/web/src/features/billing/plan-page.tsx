import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Subscription } from './billing-api'

interface PlanPageProps {
  /** undefined = still loading, null = never subscribed. */
  subscription: Subscription | null | undefined
  isWaitingForPayment: boolean
  onSubscribe: () => void
}

/** Your plan and what it unlocks. Rendering only; state lives in use-billing.ts. */
export function PlanPage({ subscription, isWaitingForPayment, onSubscribe }: PlanPageProps) {
  return (
    <div className="mx-auto max-w-[470px] space-y-4">
      <h1 className="text-2xl font-semibold">Plan</h1>
      <div className="space-y-2 rounded-lg border p-4">
        <p className="font-medium">Pro</p>
        <p className="text-sm text-muted-foreground">
          Connect AI assistants (Claude, Cursor, ...) to your mediashare account through MCP.
        </p>
        <PlanStatus subscription={subscription} isWaitingForPayment={isWaitingForPayment} />
        {!subscription?.entitled && !isWaitingForPayment && subscription !== undefined && (
          <Button onClick={onSubscribe}>Subscribe</Button>
        )}
      </div>
    </div>
  )
}

function PlanStatus({
  subscription,
  isWaitingForPayment,
}: Pick<PlanPageProps, 'subscription' | 'isWaitingForPayment'>) {
  if (isWaitingForPayment) return <p className="text-sm">Waiting for your payment to be confirmed...</p>
  if (subscription === undefined) return <p className="text-sm text-muted-foreground">Loading...</p>
  if (subscription === null) return <Badge variant="secondary">Not subscribed</Badge>
  return (
    <div className="space-y-1">
      <Badge variant={subscription.entitled ? 'default' : 'secondary'}>{subscription.status}</Badge>
      <p className="text-sm text-muted-foreground">
        {subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews'}{' '}
        {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
      </p>
    </div>
  )
}
