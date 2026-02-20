import {
  nextRequestId,
  readRequest,
  writeRequest,
  writeRequestLog,
  commitLedger,
} from "./ledger.js";
import { APP_NAME_LOWER } from "./config.js";

// Valid states and transitions for Phase 1
const VALID_TRANSITIONS = {
  ingested: ["executing"],
  executing: ["succeeded", "failed"],
  succeeded: ["applied", "executing"],
  failed: ["retrying", "needs_human"],
  retrying: ["executing"],
  needs_human: ["executing"], // manual retry
  applied: ["executing"],
};

const MAX_RETRIES = 2;

function truncate(text, maxLen) {
  const firstLine = text.split("\n")[0];
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen - 3) + "...";
}

/**
 * Create a new request from a CLI submission.
 */
export async function createRequest(projectName, description) {
  const id = await nextRequestId();
  const now = new Date().toISOString();

  const request = {
    id,
    description,
    project: projectName,
    branch: `${APP_NAME_LOWER}/${id}`,
    origin: {
      source: "cli",
      timestamp: now,
    },
    spec: [
      {
        version: 1,
        timestamp: now,
        description,
      },
    ],
    attempts: [],
    status: "ingested",
    created_at: now,
    updated_at: now,
  };

  await writeRequest(id, request);
  const brief = truncate(description, 72);
  await writeRequestLog(id, {
    timestamp: now,
    event: "created",
    message: `Request created from CLI: ${brief}`,
  });
  await commitLedger(`Ingest request ${id}: ${brief}`);

  return request;
}

/**
 * Transition a request to a new status.
 */
export async function transitionRequest(id, newStatus, logMessage) {
  const request = await readRequest(id);
  if (!request) throw new Error(`Request ${id} not found`);

  const valid = VALID_TRANSITIONS[request.status];
  if (!valid || !valid.includes(newStatus)) {
    throw new Error(
      `Invalid transition: ${request.status} -> ${newStatus} for ${id}`
    );
  }

  const now = new Date().toISOString();
  request.status = newStatus;
  request.updated_at = now;

  await writeRequest(id, request);
  await writeRequestLog(id, {
    timestamp: now,
    event: `status_changed`,
    from: request.status,
    to: newStatus,
    message: logMessage || `Status changed to ${newStatus}`,
  });
  await commitLedger(`${id}: ${request.status} -> ${newStatus}`);

  return request;
}

/**
 * Record an execution attempt on a request.
 */
export async function recordAttempt(id, { status, commit, reason, summary }) {
  const request = await readRequest(id);
  if (!request) throw new Error(`Request ${id} not found`);

  const now = new Date().toISOString();
  const attemptId = request.attempts.length + 1;
  const specVersion = request.spec[request.spec.length - 1].version;

  const attempt = {
    id: attemptId,
    spec_version: specVersion,
    timestamp: now,
    status,
    ...(commit && { commit }),
    ...(reason && { reason }),
    ...(summary && { summary }),
  };

  request.attempts.push(attempt);
  request.updated_at = now;

  // Determine new request status based on attempt result
  if (status === "succeeded") {
    request.status = "succeeded";
  } else if (status === "failed") {
    const failedAttempts = request.attempts.filter(
      (a) => a.status === "failed"
    ).length;
    if (failedAttempts >= MAX_RETRIES) {
      request.status = "needs_human";
    } else {
      request.status = "failed";
    }
  }

  await writeRequest(id, request);
  await writeRequestLog(id, {
    timestamp: now,
    event: `attempt_${status}`,
    attempt_id: attemptId,
    message:
      status === "succeeded"
        ? `Attempt ${attemptId} succeeded${summary ? ": " + summary : ""}`
        : `Attempt ${attemptId} failed: ${reason || "unknown"}`,
  });
  await commitLedger(
    `${id}: attempt ${attemptId} ${status}${reason ? " - " + reason : ""}`
  );

  return request;
}

/**
 * Mark a request as applied (PR opened).
 */
export async function markApplied(id, prUrl) {
  const request = await readRequest(id);
  if (!request) throw new Error(`Request ${id} not found`);

  const now = new Date().toISOString();
  request.status = "applied";
  request.updated_at = now;
  request.pr_url = prUrl;

  await writeRequest(id, request);
  await writeRequestLog(id, {
    timestamp: now,
    event: "applied",
    message: `PR opened: ${prUrl}`,
  });
  await commitLedger(`${id}: applied - PR ${prUrl}`);

  return request;
}

/**
 * Amend a succeeded/applied request with a new spec version.
 * Reuses the same branch so subsequent pushes update the existing PR.
 */
export async function amendRequest(id, description) {
  const request = await readRequest(id);
  if (!request) throw new Error(`Request ${id} not found`);

  if (!canAmend(request)) {
    throw new Error(
      `Request ${id} is in status "${request.status}" and cannot be amended. Only succeeded or applied requests can be amended.`
    );
  }

  const now = new Date().toISOString();
  const nextVersion = request.spec.length + 1;

  request.spec.push({
    version: nextVersion,
    timestamp: now,
    description,
  });

  const previousStatus = request.status;
  request.status = "executing";
  request.updated_at = now;

  await writeRequest(id, request);
  const brief = truncate(description, 72);
  await writeRequestLog(id, {
    timestamp: now,
    event: "amended",
    from: previousStatus,
    to: "executing",
    message: `Amended with spec v${nextVersion}: ${brief}`,
  });
  await commitLedger(`Amend ${id} (v${nextVersion}): ${brief}`);

  return request;
}

/**
 * Check if a request can be amended (add follow-up work on the same branch).
 */
export function canAmend(request) {
  return request.status === "succeeded" || request.status === "applied";
}

/**
 * Check if a request can be retried.
 * With { force: true }, any non-executing status is retryable.
 */
export function canRetry(request, { force = false } = {}) {
  if (force) return request.status !== "executing";
  return (
    request.status === "failed" ||
    request.status === "needs_human"
  );
}

/**
 * Get the number of failed attempts for a request.
 */
export function failedAttemptCount(request) {
  return request.attempts.filter((a) => a.status === "failed").length;
}
