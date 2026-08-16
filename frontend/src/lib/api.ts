import type {
  ClaimAttachment,
  ClaimCategory,
  ClaimDetail,
  ClaimLocation,
  ClaimSubmission,
  ClaimSummary,
  DocumentAnalysis,
  ValidationIssue,
  LoginResult,
  Member,
  OpticalItem
} from "../types";

interface ApiErrorBody {
  message?: string | string[];
  code?: string;
  claimId?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
    readonly claimId?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface JsonRequestInit extends Omit<RequestInit, "body"> {
  body?: unknown;
}

// Production requests stay on the Sahl origin and are forwarded to the API by
// Vercel. This keeps the HTTP-only session cookie first-party. Local Vite
// development can still use an explicit API origin or its /api proxy.
const apiOrigin = import.meta.env.DEV
  ? (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "")
  : "";

export function apiUrl(path: string) {
  return `${apiOrigin}/api${path}`;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeoutMilliseconds = path.endsWith("/documents/continue") || options?.body instanceof FormData
    ? 120_000
    : 30_000;
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMilliseconds);
  const abortFromCaller = () => controller.abort();
  options?.signal?.addEventListener("abort", abortFromCaller, { once: true });

  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...options,
      signal: controller.signal,
      credentials: "include"
    });
  } catch (error) {
    if (timedOut) {
      throw new ApiError(
        "The server took too long to respond. Please try again.",
        "REQUEST_TIMEOUT"
      );
    }
    if (error instanceof TypeError) {
      throw new ApiError(
        "We could not reach the server. Check your connection and try again.",
        "NETWORK_UNAVAILABLE"
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    options?.signal?.removeEventListener("abort", abortFromCaller);
  }

  if (!response.ok) {
    let body: ApiErrorBody = {};
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // Fall back to a general message when the API did not return JSON.
    }

    const message = Array.isArray(body.message)
      ? body.message[0]
      : body.message;

    if (
      response.status === 401 &&
      path !== "/auth/login" &&
      path !== "/auth/me"
    ) {
      window.dispatchEvent(new Event("sahl:session-expired"));
    }

    throw new ApiError(
      message ?? "Something went wrong. Please try again.",
      body.code,
      response.status,
      body.claimId
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function requestJson<T>(
  path: string,
  { body, headers: initialHeaders, ...options }: JsonRequestInit = {}
) {
  const headers = new Headers(initialHeaders);
  let requestBody: BodyInit | undefined;

  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    requestBody = JSON.stringify(body);
  }

  return request<T>(path, {
    ...options,
    headers,
    body: requestBody
  });
}

export function localizedApiError(
  error: unknown,
  isArabic: boolean,
  arabicFallback: string,
  englishFallback: string
) {
  if (isArabic) return arabicFallback;
  return error instanceof ApiError ? error.message : englishFallback;
}

export function requestFormData<T>(
  path: string,
  formData: FormData,
  method = "POST"
) {
  return request<T>(path, {
    method,
    body: formData
  });
}

export const authApi = {
  login(identifier: string, password: string) {
    return requestJson<LoginResult>("/auth/login", {
      method: "POST",
      body: { identifier, password }
    });
  },

  me() {
    return requestJson<Member>("/auth/me");
  },

  logout() {
    return requestJson<void>("/auth/logout", { method: "POST" });
  }
};

export const claimsApi = {
  list() {
    return requestJson<ClaimSummary[]>("/claims");
  },

  create(
    category: ClaimCategory,
    claimLocation: ClaimLocation,
    opticalItem?: OpticalItem
  ) {
    return requestJson<ClaimSummary>("/claims", {
      method: "POST",
      body: { category, claimLocation, opticalItem }
    });
  },

  update(
    claimId: string,
    updates: Partial<
      Pick<ClaimSummary, "category" | "claimLocation" | "opticalItem">
    >
  ) {
    return requestJson<ClaimSummary>(`/claims/${claimId}`, {
      method: "PATCH",
      body: updates
    });
  },

  discard(claimId: string) {
    return requestJson<void>(`/claims/${claimId}`, { method: "DELETE" });
  },

  get(claimId: string) {
    return requestJson<ClaimDetail>(`/claims/${claimId}`);
  },

  upload(claimId: string, files: File[]) {
    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file);
    }

    return requestFormData<ClaimAttachment[]>(
      `/claims/${claimId}/attachments`,
      formData
    );
  },

  removeAttachment(claimId: string, attachmentId: string) {
    return requestJson<void>(
      `/claims/${claimId}/attachments/${attachmentId}`,
      { method: "DELETE" }
    );
  },

  continueFromDocuments(claimId: string) {
    return requestJson<ClaimDetail>(`/claims/${claimId}/documents/continue`, {
      method: "POST"
    });
  },

  saveClaimReview(
    claimId: string,
    extracted: DocumentAnalysis["extracted"]
  ) {
    return requestJson<ClaimDetail>(
      `/claims/${claimId}/review`,
      { method: "PUT", body: { extracted } }
    );
  },

  confirmValidationIssue(
    claimId: string,
    issue: Pick<ValidationIssue, "code" | "attachmentId" | "evidenceUnitId">
  ) {
    return requestJson<ClaimDetail>(`/claims/${claimId}/validation/confirm`, {
      method: "POST",
      body: {
        code: issue.code,
        attachmentId: issue.attachmentId,
        evidenceUnitId: issue.evidenceUnitId ?? null
      }
    });
  },

  submit(claimId: string) {
    return requestJson<ClaimSubmission>(`/claims/${claimId}/submit`, {
      method: "POST"
    });
  }
};

export const opsApi = {
  status() {
    return requestJson<{ enabled: boolean }>("/ops/status");
  },

  listAccepted() {
    return requestJson<ClaimSubmission[]>("/ops/claims");
  }
};
