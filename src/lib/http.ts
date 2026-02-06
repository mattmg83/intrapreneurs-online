export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

type JsonFetchResult<T> = {
  response: Response;
  data: T | null;
  notModified: boolean;
};

const hasNoContent = (response: Response) => {
  if (response.status === 204 || response.status === 304) {
    return true;
  }

  const contentLength = response.headers.get('content-length');
  return contentLength === '0';
};

async function readBody(response: Response): Promise<{ rawText: string; data: unknown | null }> {
  if (hasNoContent(response)) {
    return {
      rawText: '',
      data: null,
    };
  }

  const rawText = await response.text();
  if (!rawText.trim()) {
    return {
      rawText,
      data: null,
    };
  }

  try {
    return {
      rawText,
      data: JSON.parse(rawText),
    };
  } catch {
    throw new Error(`Invalid JSON response (${response.status} ${response.statusText}).`);
  }
}

type FetchJsonOptions = {
  allowStatuses?: number[];
};

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: FetchJsonOptions = {},
): Promise<JsonFetchResult<T>> {
  const response = await fetch(input, init);

  if (response.status === 304) {
    return {
      response,
      data: null,
      notModified: true,
    };
  }

  const { rawText, data } = await readBody(response);

  const shouldAllow = options.allowStatuses?.includes(response.status) ?? false;

  if (!response.ok && !shouldAllow) {
    const payloadError =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : null;

    const fallbackMessage =
      rawText.trim() || `Request failed with status ${response.status} ${response.statusText}.`;

    throw new HttpError(response.status, payloadError ?? fallbackMessage);
  }

  return {
    response,
    data: (data as T | null) ?? null,
    notModified: false,
  };
}
