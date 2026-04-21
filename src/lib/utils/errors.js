class AppError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

class ValidationError extends AppError {
  constructor(message) {
    super('VALIDATION_ERROR', message, 400);
  }
}

class GrenacheError extends AppError {
  constructor(message) {
    super('GRENACHE_ERROR', message, 503);
  }
}

export { ValidationError, GrenacheError };
