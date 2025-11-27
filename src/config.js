/**
 * Configuration loader - merges CLI options with environment variables
 */

export function loadConfig(cliOptions) {
  return {
    // Interval between batches (seconds)
    interval: parseInt(
      cliOptions.interval || 
      process.env.STREAMHUB_INTERVAL || 
      '5'
    ),
    
    // Number of frames per batch
    size: parseInt(
      cliOptions.size || 
      process.env.STREAMHUB_SIZE || 
      '1'
    ),
    
    // API base URL
    baseUrl: (
      cliOptions.baseUrl || 
      process.env.STREAMHUB_BASE_URL || 
      'http://localhost:8080'
    ).replace(/\/$/, ''), // Remove trailing slash
    
    // Device identifier
    deviceId: 
      cliOptions.deviceId || 
      process.env.STREAMHUB_DEVICE_ID || 
      `device-${Date.now()}`,
    
    // Secondary index key for frame lookup
    secondaryKey:
      cliOptions.secondaryKey ||
      process.env.STREAMHUB_SECONDARY_KEY ||
      null,
    
    // Direct JWT token
    authToken: 
      cliOptions.authToken || 
      process.env.STREAMHUB_AUTH_TOKEN,
    
    // OAuth2 client credentials
    clientId: 
      cliOptions.clientId || 
      process.env.STREAMHUB_CLIENT_ID,
    
    clientSecret: 
      cliOptions.clientSecret || 
      process.env.STREAMHUB_CLIENT_SECRET,
    
    // OAuth2 token endpoint
    tokenUrl: 
      cliOptions.tokenUrl || 
      process.env.STREAMHUB_TOKEN_URL,
    
    // OAuth2 audience (for Auth0)
    audience: 
      cliOptions.audience || 
      process.env.STREAMHUB_AUDIENCE,
    
    // Loop mode
    loop: cliOptions.loop || process.env.STREAMHUB_LOOP === 'true',
    
    // Verbose logging
    verbose: cliOptions.verbose || process.env.STREAMHUB_VERBOSE === 'true',
    
    // Dry run mode
    dryRun: cliOptions.dryRun || process.env.STREAMHUB_DRY_RUN === 'true',
  };
}

/**
 * Validate configuration
 */
export function validateConfig(config) {
  const errors = [];

  if (!config.authToken && !config.clientId) {
    errors.push('Either --auth-token or --client-id/--client-secret must be provided');
  }

  if (config.clientId && !config.clientSecret) {
    errors.push('--client-secret is required when using --client-id');
  }

  if (config.clientId && !config.tokenUrl) {
    errors.push('--token-url is required when using --client-id');
  }

  if (config.interval < 1) {
    errors.push('--interval must be at least 1 second');
  }

  if (config.size < 1) {
    errors.push('--size must be at least 1');
  }

  return errors;
}
