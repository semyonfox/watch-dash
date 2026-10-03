(function configureTelemetry(root) {
  // owner configuration only; enabling collection also requires host permission
  root.WatchDashTelemetryConfig = Object.freeze({
    enabled: false,
    endpoint: "",
  });
})(globalThis);
