import axios, { AxiosInstance } from "axios";

export function createHttpClient(baseURL?: string): AxiosInstance {
  return axios.create({
    baseURL,
    timeout: 15000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      Accept: "application/json, text/html, */*",
      "Accept-Language": "en-US,en;q=0.9",
    },
    validateStatus: () => true, // don't throw on any status
  });
}

/**
 * Probe a URL with a quick HEAD to check if it exists or returns JSON.
 */
export async function quickProbe(url: string): Promise<ProbeResult> {
  try {
    const resp = await axios.head(url, {
      timeout: 5000,
      validateStatus: () => true,
      headers: { "User-Agent": "DeepResearchAgent/1.0" },
    });
    return parseProbeResponse(resp);
  } catch {
    return { ok: false, status: 0, contentType: null, isJson: false };
  }
}

/**
 * Probe a URL with GET + optional auth headers.
 * Some APIs reject HEAD (405) but accept GET.
 * Some require auth headers to return useful responses.
 */
export async function authenticatedProbe(
  url: string,
  headers: Record<string, string> = {}
): Promise<ProbeResult> {
  try {
    const resp = await axios.get(url, {
      timeout: 8000,
      validateStatus: () => true,
      headers: {
        "User-Agent": "DeepResearchAgent/1.0",
        Accept: "application/json",
        ...headers,
      },
      // Only download first chunk to check Content-Type
      maxContentLength: 1024,
      responseType: "stream",
    });
    return parseProbeResponse(resp);
  } catch {
    return { ok: false, status: 0, contentType: null, isJson: false };
  }
}

interface ProbeResult {
  ok: boolean;
  status: number;
  contentType: string | null;
  isJson: boolean;
}

function parseProbeResponse(resp: any): ProbeResult {
  const ct = String(resp.headers["content-type"] || "");
  return {
    ok: resp.status < 400,
    status: resp.status,
    contentType: ct || null,
    isJson: ct.toLowerCase().includes("json"),
  };
}
