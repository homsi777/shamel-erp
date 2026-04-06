export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(statusCode: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;

export const appError = (
  statusCode: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
) => new AppError(statusCode, code, message, details);

