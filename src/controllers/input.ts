import { UserFacingError } from "../models/dataStore";
import { parseCents, type Cents } from "../models/money";

/** Reads a typed amount or explains what is wrong with it. */
export function requireCents(text: string, label = "Amount"): Cents {
  const cents = parseCents(text);
  if (cents === null) throw new UserFacingError(`${label}: enter an amount like 12.34`);
  return cents;
}

/** Trims a name and requires it to be 1–100 characters. */
export function requireName(text: string, label = "Name"): string {
  const name = text.trim();
  if (!name) throw new UserFacingError(`${label} is required`);
  if (name.length > 100) throw new UserFacingError(`${label} must be 100 characters or fewer`);
  return name;
}
