type LogFields = Record<string, unknown>;

function log(level: "info" | "warn" | "error", message: string, fields?: LogFields) {
  const entry = { level, message, time: new Date().toISOString(), ...fields };
  // Structured, single-line JSON logs so a request ID can be grepped across a run.
  console[level === "error" ? "error" : "log"](JSON.stringify(entry));
}

export const logger = {
  info: (message: string, fields?: LogFields) => log("info", message, fields),
  warn: (message: string, fields?: LogFields) => log("warn", message, fields),
  error: (message: string, fields?: LogFields) => log("error", message, fields),
};
