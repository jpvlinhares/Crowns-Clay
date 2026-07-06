/**
 * Sim assertions (TDD §13): cheap invariant guards that stay in release builds,
 * plus dev-only asserts stripped by the bundler (wired in M6+; identity for now).
 */

export class InvariantViolation extends Error {
  constructor(message: string) {
    super(`Invariant violated: ${message}`);
    this.name = 'InvariantViolation';
  }
}

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InvariantViolation(message);
}
