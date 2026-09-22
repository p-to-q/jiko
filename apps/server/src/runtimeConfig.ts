const defaultServerHost = "127.0.0.1";

export function resolveServerHost(configuredHost: string | undefined): string {
  return configuredHost?.trim() || defaultServerHost;
}
