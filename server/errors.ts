/** Error with a stable code. The interface changes the code into a message. See contract/api.md. */
export class ApiError extends Error {
  constructor(
    public status: 401 | 403 | 404 | 409 | 422 | 502,
    public code: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}
