// Adapter around the media api's HTTP interface. Every call carries the exchanged api token,
// so the api sees the real user and applies its own checks (ADR 0003).
import { config } from '../config.js'
import { type ExchangeSubject, exchangeForApiToken } from './token-exchange.js'

/** The api answered with an error; its message is safe to show to the model. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function callApi(user: ExchangeSubject, method: 'GET' | 'PUT', path: string): Promise<unknown> {
  const apiToken = await exchangeForApiToken(user)
  const response = await fetch(`${config.apiUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${apiToken}` },
  })
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
  if (!response.ok) {
    throw new ApiError(response.status, body.error?.message ?? `api answered HTTP ${response.status}`)
  }
  return body
}

export const apiClient = {
  get: (user: ExchangeSubject, path: string) => callApi(user, 'GET', path),
  put: (user: ExchangeSubject, path: string) => callApi(user, 'PUT', path),
}
