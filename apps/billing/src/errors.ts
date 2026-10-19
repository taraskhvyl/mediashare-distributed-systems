/**
 * A failure the caller caused or can act on. Services throw it without knowing about HTTP;
 * the error handler in http/app.ts maps `code` to a status. Anything else is a logged 500.
 */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export type DomainErrorCode = 'bad_request' | 'bad_signature' | 'invalid_state' | 'provider_unavailable'
