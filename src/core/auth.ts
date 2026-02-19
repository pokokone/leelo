/**
 * Reddit authentication manager
 */

import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { z } from 'zod';

export interface AuthConfig {
  clientId: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
  userAgent?: string;
  deviceId?: string;
}

// Zod schema for OAuth token response validation
const OAuthTokenResponseSchema = z.object({
  access_token: z.string().min(1, 'access_token must not be empty'),
  token_type: z.string().min(1, 'token_type must not be empty'),
  expires_in: z.number().positive('expires_in must be positive'),
  scope: z.string(),
}).strict().passthrough(); // Strict mode + passthrough for extra fields

export class AuthManager {
  private config: AuthConfig | null = null;
  private configPath: string;
  // Lock for token refresh to prevent concurrent refresh attempts (race conditions)
  private tokenRefreshPromise: Promise<void> | null = null;
  // Token expiration buffer (refresh 10 seconds before actual expiration to handle clock drift)
  private readonly TOKEN_EXPIRATION_BUFFER_MS = 10000;

  constructor() {
    this.configPath = this.getConfigPath();
  }

  /**
   * Load authentication configuration
   */
  async load(): Promise<AuthConfig | null> {
    // First check environment variables
    const envConfig = this.loadFromEnv();
    if (envConfig) {
      this.config = envConfig;
      return this.config;
    }

    // Then check config file
    try {
      const configFile = join(this.configPath, 'auth.json');
      const data = await fs.readFile(configFile, 'utf-8');
      this.config = JSON.parse(data);

      // Validate config
      if (this.config && !this.isValidConfig(this.config)) {
        console.error('Invalid auth configuration found');
        this.config = null;
      }

      return this.config;
    } catch (error) {
      // No auth configured or invalid file
      return null;
    }
  }

  /**
   * Load configuration from environment variables
   */
  private loadFromEnv(): AuthConfig | null {
    const clientId = this.cleanEnvVar(process.env.REDDIT_CLIENT_ID);
    const userAgent = this.cleanEnvVar(process.env.REDDIT_USER_AGENT);

    // Need at least client ID
    if (!clientId) {
      return null;
    }

    return {
      clientId,
      userAgent: userAgent || 'RedditInstalledApp/1.0'
    };
  }

  /**
   * Clean environment variable value
   * Handles empty strings, undefined, and unresolved template strings
   */
  private cleanEnvVar(value: string | undefined): string | undefined {
    if (!value) return undefined;

    const trimmed = value.trim();

    // Treat empty strings as undefined
    if (trimmed === '') return undefined;

    // Treat unresolved template strings as undefined
    // (happens when Claude Desktop doesn't have the config value set)
    // Handles various template patterns:
    // - ${VAR} - standard template
    // - ${VAR:-default} - template with default
    // - ${${VAR}} - nested template
    // - ${ or } alone - partial/malformed templates
    // - ${VAR}${VAR2} - multiple templates
    if (this.containsUnresolvedTemplate(trimmed)) {
      return undefined;
    }

    return trimmed;
  }

  /**
   * Check if a string contains unresolved template patterns
   */
  private containsUnresolvedTemplate(value: string): boolean {
    // Check for any ${...} pattern (including nested, with defaults, etc.)
    if (/\$\{[^}]*\}/.test(value)) {
      return true;
    }

    // Check for unclosed template start: ${ without matching }
    if (value.includes('${') && !value.includes('}')) {
      return true;
    }

    // Check for orphaned template syntax that looks like unresolved vars
    // e.g., "$REDDIT_CLIENT_ID" without braces (common in some configs)
    if (/\$[A-Z_][A-Z0-9_]*/.test(value)) {
      return true;
    }

    return false;
  }

  /**
   * Save authentication configuration
   */
  async save(config: AuthConfig): Promise<void> {
    try {
      // Ensure directory exists
      await fs.mkdir(this.configPath, { recursive: true });

      // Save config
      const configFile = join(this.configPath, 'auth.json');
      await fs.writeFile(
        configFile,
        JSON.stringify(config, null, 2),
        { mode: 0o600 } // Read/write for owner only
      );

      // Verify file permissions were actually applied (security check)
      const stats = await fs.stat(configFile);
      const mode = stats.mode & parseInt('777', 8); // Extract permission bits
      if (mode !== 0o600) {
        console.error(`Warning: Auth file permissions are ${mode.toString(8)}, expected 600`);
        // On some systems, chmod after write may be needed
        try {
          await fs.chmod(configFile, 0o600);
        } catch (chmodError) {
          throw new Error(`Failed to set auth file permissions to 0o600: ${chmodError}`);
        }
      }

      this.config = config;
    } catch (error) {
      throw new Error(`Failed to save auth configuration: ${error}`);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): AuthConfig | null {
    return this.config;
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.config !== null &&
      this.config.clientId !== undefined;
  }

  /**
   * Check if token is expired or will expire soon (including buffer for clock drift)
   * Returns true if:
   * - No expiresAt set
   * - Current time >= expiresAt
   * - Current time >= expiresAt - buffer (to handle clock drift and refresh early)
   */
  isTokenExpired(): boolean {
    if (!this.config?.expiresAt || this.config.expiresAt <= 0) return true;
    // Consider token expired if we're within the buffer time before actual expiration
    // This prevents using an expired token due to clock drift between client and server
    const expirationThreshold = this.config.expiresAt - this.TOKEN_EXPIRATION_BUFFER_MS;
    return Date.now() >= expirationThreshold;
  }

  /**
   * Get access token for Reddit OAuth
   */
  async getAccessToken(): Promise<string | null> {
    if (!this.config) return null;

    // For script apps, we can use app-only auth
    if (!this.config.accessToken || this.isTokenExpired()) {
      // Wait for any in-flight refresh to complete, or start a new one
      if (this.tokenRefreshPromise) {
        await this.tokenRefreshPromise;
      } else {
        await this.refreshAccessToken();
      }
    }

    return this.config.accessToken || null;
  }

  /**
   * Refresh access token using client credentials
   * Uses a lock to prevent concurrent refresh attempts (race conditions)
   */
  async refreshAccessToken(): Promise<void> {
    // If a refresh is already in progress, wait for it to complete
    if (this.tokenRefreshPromise) {
      await this.tokenRefreshPromise;
      return;
    }

    // Create a promise for this refresh and store it
    const refreshPromise = this.doRefreshAccessToken();
    this.tokenRefreshPromise = refreshPromise;

    try {
      await refreshPromise;
    } finally {
      // Clear the promise when done (success or error)
      this.tokenRefreshPromise = null;
    }
  }

  /**
   * Internal implementation of token refresh (protected by lock)
   */
  private async doRefreshAccessToken(): Promise<void> {
    if (!this.config?.clientId) {
      throw new Error('No client ID configured');
    }

    try {
      // Installed app grant type (no secret)
      const auth = Buffer.from(`${this.config.clientId}:`).toString('base64');

      if (!this.config.deviceId) {
        this.config.deviceId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      }

      const body = new URLSearchParams({
        grant_type: 'https://oauth.reddit.com/grants/installed_client',
        device_id: this.config.deviceId
      }).toString();

      const response = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': this.config.userAgent || 'RedditBuddy/1.0 (by /u/karanb192)'
        },
        body
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to get access token: ${response.status} - ${error}`);
      }

      const rawData = await response.json();

      // Validate token response structure
      let data;
      try {
        data = OAuthTokenResponseSchema.parse(rawData);
      } catch (validationError) {
        if (validationError instanceof z.ZodError) {
          const issues = validationError.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
          throw new Error(`Invalid OAuth token response format: ${issues}`);
        }
        throw new Error('Failed to validate OAuth token response');
      }

      // Calculate expiration time
      const expiresAt = Date.now() + (data.expires_in * 1000);

      // Update config
      this.config.accessToken = data.access_token;
      this.config.expiresAt = expiresAt;
      this.config.scope = data.scope;

      // Save updated config
      await this.save(this.config);
    } catch (error) {
      throw new Error(`Failed to refresh access token: ${error}`);
    }
  }

  /**
   * Clear authentication
   */
  async clear(): Promise<void> {
    this.config = null;

    try {
      const configFile = join(this.configPath, 'auth.json');
      await fs.unlink(configFile);
    } catch {
      // File might not exist
    }
  }

  /**
   * Get headers for Reddit API requests
   */
  async getHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'User-Agent': 'RedditBuddy/1.0 (by /u/karanb192)',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache'
    };

    const token = await this.getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
  }

  /**
   * Get rate limit based on auth status
   */
  getRateLimit(): number {
    return this.isAuthenticated() ? 60 : 10;
  }

  /**
   * Get cache TTL based on auth status (in ms)
   */
  getCacheTTL(): number {
    return this.isAuthenticated()
      ? 5 * 60 * 1000  // 5 minutes for authenticated
      : 15 * 60 * 1000; // 15 minutes for unauthenticated
  }

  /**
   * Check if we have full authentication (with user credentials)
   */
  hasFullAuth(): boolean {
    return this.isAuthenticated();
  }

  /**
   * Get auth mode string for display
   */
  getAuthMode(): string {
    return this.isAuthenticated() ? 'Installed-App' : 'Anonymous';
  }

  /**
   * Private: Get configuration directory path based on OS
   */
  private getConfigPath(): string {
    const home = homedir();

    switch (platform()) {
      case 'win32':
        return join(
          process.env.APPDATA || join(home, 'AppData', 'Roaming'),
          'reddit-mcp-buddy'
        );
      case 'darwin':
        return join(home, 'Library', 'Application Support', 'reddit-mcp-buddy');
      default: // linux and others
        return join(
          process.env.XDG_CONFIG_HOME || join(home, '.config'),
          'reddit-mcp-buddy'
        );
    }
  }

  /**
   * Private: Validate configuration
   */
  private isValidConfig(config: any): config is AuthConfig {
    return config &&
      typeof config.clientId === 'string' && config.clientId.length > 0;
  }

  /**
   * Setup wizard for authentication
   */
  static async runSetupWizard(): Promise<AuthConfig> {
    throw new Error('Please set REDDIT_CLIENT_ID environment variable.');
  }
}