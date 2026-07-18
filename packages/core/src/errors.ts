/**
 * Represents an HTTP error with a status code and message.
 * Throw this inside any route handler to send a structured error response.
 *
 * @example
 * throw new HttpError(404, 'User not found');
 *
 * @example Wrapping an unknown caught error
 * catch (err) {
 *   throw HttpError.from(err, 500);
 * }
 */
export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    Error.captureStackTrace(this, HttpError);
  }

  /**
   * Wraps an unknown caught value into an `HttpError`.
   * If the value is already an `HttpError`, it is returned as-is.
   * Otherwise the `message` from the caught `Error` (or a fallback) is used.
   *
   * @example
   * } catch (err) {
   *   throw HttpError.from(err, 500, 'Something went wrong');
   * }
   */
  static from(err: unknown, statusCode = 500, fallback = 'Internal Server Error'): HttpError {
    if (err instanceof HttpError) return err;
    const message = err instanceof Error ? err.message : fallback;
    return new HttpError(statusCode, message);
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

/**
 * Type guard — returns `true` when `value` is an `HttpError` instance.
 *
 * @example
 * if (isHttpError(err)) console.log(err.statusCode);
 */
export function isHttpError(value: unknown): value is HttpError {
  return value instanceof HttpError;
}
