export class RequestBodyTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes.`);
    this.name = "RequestBodyTooLargeError";
  }
}

export class UnsupportedContentTypeError extends Error {
  constructor(public readonly expected: string) {
    super(`Expected ${expected}.`);
    this.name = "UnsupportedContentTypeError";
  }
}

export function assertContentType(request: Request, expected: string) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith(expected.toLowerCase())) throw new UnsupportedContentTypeError(expected);
}

export function assertContentLength(request: Request, maxBytes: number) {
  const raw = request.headers.get("content-length");
  if (!raw) return;
  const length = Number.parseInt(raw, 10);
  if (Number.isFinite(length) && length > maxBytes) throw new RequestBodyTooLargeError(maxBytes);
}

export async function readLimitedJson<T>(request: Request, maxBytes: number): Promise<T> {
  assertContentType(request, "application/json");
  return JSON.parse(await readLimitedText(request, maxBytes)) as T;
}

export async function readLimitedText(request: Request, maxBytes: number): Promise<string> {
  assertContentLength(request, maxBytes);

  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError(maxBytes);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}
