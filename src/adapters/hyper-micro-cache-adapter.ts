/**
 * @fileoverview Hyper-Micro Cache Adapter
 *
 * Reference implementation of a CacheAdapter that connects to hyper-micro
 * cache API. This adapter allows external services (like scout-live) to
 * use hyper-micro as their caching backend.
 *
 * ## Usage
 * ```typescript
 * import { HyperMicroCacheAdapter } from './adapters/hyper-micro-cache-adapter';
 *
 * const cache = new HyperMicroCacheAdapter({
 *   url: 'http://localhost:3000',
 *   apiKey: 'your-api-key'
 * });
 *
 * await cache.set('user:123', { name: 'Alice' }, 60);
 * const { value, found } = await cache.get('user:123');
 * ```
 *
 * @module adapters/hyper-micro-cache-adapter
 */

/**
 * CacheAdapter interface matching scout-live CachePort spec.
 *
 * This interface defines the contract for a caching layer that can be
 * used as the backend for scout-live and other services.
 */
export interface CacheAdapter {
  /**
   * Retrieves a value from the cache.
   *
   * @param key - The key to retrieve
   * @param namespace - Optional namespace for the key
   * @returns Promise resolving to an object with value and found status
   */
  get(key: string, namespace?: string): Promise<{ value: unknown; found: boolean }>;

  /**
   * Stores a value in the cache with optional TTL.
   *
   * @param key - The key to store
   * @param value - The value to store (must be JSON-serializable)
   * @param ttl - Optional time-to-live in seconds
   * @param namespace - Optional namespace for the key
   * @returns Promise that resolves when the value is stored
   */
  set(key: string, value: unknown, ttl?: number, namespace?: string): Promise<void>;

  /**
   * Deletes a value from the cache.
   *
   * @param key - The key to delete
   * @param namespace - Optional namespace for the key
   * @returns Promise resolving to true if the key existed
   */
  delete(key: string, namespace?: string): Promise<boolean>;

  /**
   * Checks if a key exists in the cache.
   *
   * @param key - The key to check
   * @param namespace - Optional namespace for the key
   * @returns Promise resolving to true if the key exists
   */
  has(key: string, namespace?: string): Promise<boolean>;

  /**
   * Increments a numeric value atomically.
   *
   * @param key - The key to increment
   * @param by - Amount to increment by (default: 1)
   * @param namespace - Optional namespace for the key
   * @returns Promise resolving to the new value after increment
   */
  incr(key: string, by?: number, namespace?: string): Promise<number>;

  /**
   * Gets the remaining TTL for a key.
   *
   * @param key - The key to check
   * @param namespace - Optional namespace for the key
   * @returns Promise resolving to remaining seconds, -1 (permanent), or -2 (not found)
   */
  ttl(key: string, namespace?: string): Promise<number>;

  /**
   * Tests the connection to the cache.
   *
   * @returns Promise resolving to connection status and latency
   */
  testConnection(): Promise<{ ok: boolean; latencyMs: number }>;
}

/**
 * Configuration for HyperMicroCacheAdapter.
 */
export interface HyperMicroCacheConfig {
  /** Base URL of the hyper-micro server (e.g., 'http://localhost:3000') */
  url: string;
  /** API key for authentication */
  apiKey: string;
  /** Default namespace for all operations (optional) */
  defaultNamespace?: string;
  /** Request timeout in milliseconds (default: 5000) */
  timeout?: number;
}

/**
 * Response from the hyper-micro cache API.
 */
interface CacheResponse<T = unknown> {
  ok?: boolean;
  error?: string;
  message?: string;
  data?: T;
}

/**
 * Hyper-Micro Cache Adapter
 *
 * Implements the CacheAdapter interface for connecting to a hyper-micro
 * cache server over HTTP. Uses the REST API for all cache operations.
 *
 * @example
 * ```typescript
 * const cache = new HyperMicroCacheAdapter({
 *   url: 'http://localhost:3000',
 *   apiKey: 'secret'
 * });
 *
 * // Set a value with 60 second TTL
 * await cache.set('session:abc', { userId: 123 }, 60);
 *
 * // Get the value
 * const { value, found } = await cache.get('session:abc');
 * if (found) {
 *   console.log(value); // { userId: 123 }
 * }
 *
 * // Check TTL
 * const remaining = await cache.ttl('session:abc');
 * console.log(remaining); // 58
 *
 * // Health check
 * const health = await cache.testConnection();
 * console.log(health); // { ok: true, latencyMs: 5 }
 * ```
 */
export class HyperMicroCacheAdapter implements CacheAdapter {
  private baseUrl: string;
  private apiKey: string;
  private defaultNamespace?: string;
  private timeout: number;

  /**
   * Creates a new HyperMicroCacheAdapter instance.
   *
   * @param config - Configuration object
   */
  constructor(config: HyperMicroCacheConfig) {
    this.baseUrl = config.url.replace(/\/+$/, ''); // Remove trailing slash
    this.apiKey = config.apiKey;
    this.defaultNamespace = config.defaultNamespace;
    this.timeout = config.timeout ?? 5000;
  }

  /**
   * Builds the URL with namespace query param if needed.
   *
   * @param path - API path
   * @param namespace - Optional namespace override
   * @returns Full URL string
   * @private
   */
  private buildUrl(path: string, namespace?: string): string {
    const ns = namespace ?? this.defaultNamespace;
    const url = new URL(path, this.baseUrl);
    if (ns) {
      url.searchParams.set('namespace', ns);
    }
    return url.toString();
  }

  /**
   * Makes an HTTP request to the hyper-micro API.
   *
   * @param method - HTTP method
   * @param path - API path
   * @param body - Request body (optional)
   * @param namespace - Optional namespace
   * @returns Promise resolving to parsed response
   * @private
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    namespace?: string
  ): Promise<CacheResponse<T>> {
    const url = this.buildUrl(path, namespace);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json() as CacheResponse<T>;

      if (!response.ok) {
        return {
          ok: false,
          error: data.error ?? data.message ?? `HTTP ${response.status}`,
        };
      }

      return data;
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof Error && err.name === 'AbortError') {
        return { ok: false, error: 'Request timeout' };
      }

      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  /**
   * Retrieves a value from the cache.
   *
   * @param key - The key to retrieve
   * @param namespace - Optional namespace override
   * @returns Promise resolving to an object with value and found status
   */
  async get(key: string, namespace?: string): Promise<{ value: unknown; found: boolean }> {
    const response = await this.request<{ value: unknown; found: boolean }>(
      'GET',
      `/api/cache/${encodeURIComponent(key)}`,
      undefined,
      namespace
    );

    if (!response.ok) {
      return { value: null, found: false };
    }

    return response.data as { value: unknown; found: boolean };
  }

  /**
   * Stores a value in the cache with optional TTL.
   *
   * @param key - The key to store
   * @param value - The value to store (must be JSON-serializable)
   * @param ttl - Optional time-to-live in seconds
   * @param namespace - Optional namespace override
   * @returns Promise that resolves when the value is stored
   */
  async set(key: string, value: unknown, ttl?: number, namespace?: string): Promise<void> {
    const response = await this.request(
      'POST',
      '/api/cache/set',
      { key, value, ttl },
      namespace
    );

    if (!response.ok) {
      throw new Error(response.error ?? 'Failed to set cache value');
    }
  }

  /**
   * Deletes a value from the cache.
   *
   * @param key - The key to delete
   * @param namespace - Optional namespace override
   * @returns Promise resolving to true if the key existed
   */
  async delete(key: string, namespace?: string): Promise<boolean> {
    const response = await this.request<{ deleted: boolean }>(
      'DELETE',
      `/api/cache/${encodeURIComponent(key)}`,
      undefined,
      namespace
    );

    if (!response.ok) {
      return false;
    }

    return response.data?.deleted ?? false;
  }

  /**
   * Checks if a key exists in the cache.
   *
   * @param key - The key to check
   * @param namespace - Optional namespace override
   * @returns Promise resolving to true if the key exists
   */
  async has(key: string, namespace?: string): Promise<boolean> {
    const response = await this.request<{ exists: boolean }>(
      'GET',
      `/api/cache/${encodeURIComponent(key)}/exists`,
      undefined,
      namespace
    );

    if (!response.ok) {
      return false;
    }

    return response.data?.exists ?? false;
  }

  /**
   * Increments a numeric value atomically.
   *
   * @param key - The key to increment
   * @param by - Amount to increment by (default: 1)
   * @param namespace - Optional namespace override
   * @returns Promise resolving to the new value after increment
   */
  async incr(key: string, by: number = 1, namespace?: string): Promise<number> {
    const response = await this.request<{ value: number }>(
      'POST',
      `/api/cache/${encodeURIComponent(key)}/increment`,
      { by },
      namespace
    );

    if (!response.ok) {
      throw new Error(response.error ?? 'Failed to increment value');
    }

    return response.data?.value ?? 0;
  }

  /**
   * Gets the remaining TTL for a key.
   *
   * @param key - The key to check
   * @param namespace - Optional namespace override
   * @returns Promise resolving to remaining seconds, -1 (permanent), or -2 (not found)
   */
  async ttl(key: string, namespace?: string): Promise<number> {
    const response = await this.request<{ ttl: number }>(
      'GET',
      `/api/cache/${encodeURIComponent(key)}/ttl`,
      undefined,
      namespace
    );

    if (!response.ok) {
      return -2; // Not found or error
    }

    return response.data?.ttl ?? -2;
  }

  /**
   * Tests the connection to the cache using the public health endpoint.
   * No authentication required for this endpoint.
   *
   * @returns Promise resolving to connection status and latency
   */
  async testConnection(): Promise<{ ok: boolean; latencyMs: number }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const start = Date.now();

      const response = await fetch(`${this.baseUrl}/api/cache/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - start;

      if (!response.ok) {
        return { ok: false, latencyMs };
      }

      const data = await response.json() as { ok?: boolean; latencyMs?: number };

      return {
        ok: data.ok ?? true,
        latencyMs: data.latencyMs ?? latencyMs,
      };
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof Error && err.name === 'AbortError') {
        return { ok: false, latencyMs: this.timeout };
      }

      return { ok: false, latencyMs: 0 };
    }
  }
}

export default HyperMicroCacheAdapter;