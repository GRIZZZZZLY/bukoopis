import type { Context } from "hono";
import type { ZodError } from "zod";

export function notFound(c: Context, resource: string) {
  return c.json({ error: "not_found", details: { resource } }, 404);
}

export function validationFailed(c: Context, err: ZodError) {
  return c.json({ error: "validation_failed", details: err.flatten() }, 400);
}

export function badRequest(c: Context, message: string) {
  return c.json({ error: "bad_request", details: { message } }, 400);
}
