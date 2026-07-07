/**
 * Represents an HTTP error with a status code and message.
 * Throw this inside any route handler to send a structured error response.
 *
 * @example
 * throw new HttpError(404, 'User not found');
 */
export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    Error.captureStackTrace(this, HttpError);
  }

  /** Returns a plain object representation suitable for JSON serialization. */
  toJSON(): { statusCode: number; error: string; message: string } {
    return {
      statusCode: this.statusCode,
      error: this.name,
      message: this.message,
    };
  }
}
