import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

/**
 * API Client for StreamHub frame ingestion
 */
export class ApiClient {
  constructor(config) {
    this.config = config;
    this.accessToken = config.authToken;
    this.tokenExpiry = null;
  }

  /**
   * Initialize the client (get token if using OAuth2)
   */
  async initialize() {
    if (this.config.clientId && this.config.clientSecret) {
      await this.refreshToken();
    }
  }

  /**
   * Get current access token, refreshing if needed
   */
  async getToken() {
    // If using direct token, return it
    if (this.config.authToken && !this.config.clientId) {
      return this.config.authToken;
    }

    // Check if token needs refresh (refresh 5 minutes before expiry)
    if (this.tokenExpiry && Date.now() > this.tokenExpiry - 300000) {
      await this.refreshToken();
    }

    return this.accessToken;
  }

  /**
   * Refresh OAuth2 access token
   */
  async refreshToken() {
    const { clientId, clientSecret, tokenUrl, audience } = this.config;

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });

    if (audience) {
      body.append('audience', audience);
    }

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token refresh failed: ${response.status} - ${text}`);
    }

    const data = await response.json();
    
    this.accessToken = data.access_token;
    // Set expiry (default to 1 hour if not provided)
    this.tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  }

  /**
   * Send frames to StreamHub API
   */
  async sendFrames(framePaths, deviceId, timestamp, secondaryKey = null) {
    const token = await this.getToken();
    const requestId = randomUUID();
    const requestTimestamp = Math.floor(Date.now() / 1000);
    
    // Use native FormData with Blob for proper multipart handling
    const form = new FormData();
    form.append('device_id', deviceId);
    form.append('timestamp', timestamp);

    // Add optional secondary key
    if (secondaryKey) {
      form.append('secondary_key', secondaryKey);
    }

    // Add each frame as a Blob
    for (const framePath of framePaths) {
      const filename = path.basename(framePath);
      const fileBuffer = fs.readFileSync(framePath);
      const contentType = this.getContentType(framePath);
      
      // Create a Blob from the file buffer
      const blob = new Blob([fileBuffer], { type: contentType });
      form.append('frame', blob, filename);
    }

    const url = `${this.config.baseUrl}/v1/stream/frames`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Request-Id': requestId,
        'X-Request-Timestamp': requestTimestamp.toString(),
      },
      body: form,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API request failed: ${response.status} - ${text}`);
    }

    const result = await response.json();
    
    // Include request tracking info in result
    return {
      ...result,
      requestId: response.headers.get('X-Request-Id') || requestId,
      requestTimestamp: response.headers.get('X-Request-Timestamp') || requestTimestamp,
    };
  }

  /**
   * Get content type based on file extension
   */
  getContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
    };
    return types[ext] || 'application/octet-stream';
  }
}
