// Errors the deletion engine throws to signal state the route handler must
// translate into HTTP responses. Everything else (DB failures, unexpected
// exceptions) propagates and the route's errorHandler returns 500.

export class AlreadyDeletedError extends Error {
  constructor() {
    super("account_already_deleted");
    this.name = "AlreadyDeletedError";
  }
}

export class OwnerMustTransferFirstError extends Error {
  constructor() {
    super("must_transfer_first");
    this.name = "OwnerMustTransferFirstError";
  }
}
