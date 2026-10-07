const allowedUploaders = new Set(
  (process.env.ALLOWED_UPLOADERS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

export function authenticatedEmail(request: Request) {
  return request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() ?? "";
}

export function isAuthorizedUploader(email: string) {
  return allowedUploaders.has(email);
}
