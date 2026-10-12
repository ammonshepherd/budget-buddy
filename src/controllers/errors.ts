import { UserFacingError } from "../models/dataStore";

/** A message to show for any thrown value. Unexpected errors are logged in full. */
export function messageOf(error: unknown): string {
  if (error instanceof UserFacingError) return error.message;
  console.error(error);
  return error instanceof Error
    ? `Something went wrong: ${error.message}`
    : "Something went wrong.";
}
