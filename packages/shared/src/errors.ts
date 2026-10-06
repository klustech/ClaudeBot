export class TradingSystemError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Thrown when a component attempts something the safety architecture forbids. */
export class SafetyViolation extends TradingSystemError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "SAFETY_VIOLATION", details);
  }
}

export class LockedPeriodViolation extends TradingSystemError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "LOCKED_PERIOD_VIOLATION", details);
  }
}

export class ImmutabilityViolation extends TradingSystemError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "IMMUTABILITY_VIOLATION", details);
  }
}

export class LifecycleViolation extends TradingSystemError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "LIFECYCLE_VIOLATION", details);
  }
}

export class ProtectedConfigTampered extends TradingSystemError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "PROTECTED_CONFIG_TAMPERED", details);
  }
}
