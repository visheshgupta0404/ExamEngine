export function previewAllowed(hostname, config) {
  return (
    config.preview === true &&
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)
  );
}
