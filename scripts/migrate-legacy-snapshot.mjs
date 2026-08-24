import crypto from "node:crypto";
import process from "node:process";
import pg from "pg";

try {
  process.loadEnvFile(".env.local");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const apply = process.argv.includes("--apply") || process.env.MLH_MIGRATE_LEGACY_APPLY === "true";
const url = new URL(databaseUrl);
const isSupabase = url.hostname.endsWith(".supabase.com");
const supabaseCa = process.env.SUPABASE_CA_CERT?.replace(/\\n/g, "\n");
const databaseCa = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
if (isSupabase && !supabaseCa) throw new Error("SUPABASE_CA_CERT is required for verified Supabase TLS");
url.searchParams.delete("sslmode");
const client = new pg.Client({ connectionString: url.toString(), ssl: { ...(isSupabase ? { ca: supabaseCa } : databaseCa ? { ca: databaseCa } : {}), rejectUnauthorized: true } });

const mapValue = (value, key) => new Map(Array.isArray(value?.[key]) ? value[key] : []);
const arrayValue = (value, key) => Array.isArray(value?.[key]) ? value[key] : [];
const iso = (value) => value || new Date(0).toISOString();

await client.connect();
try {
  const row = (await client.query("SELECT value, revision, updated_at FROM mlh_store WHERE key = 'main' FOR SHARE")).rows[0];
  if (!row) throw new Error("Legacy mlh_store/main does not exist");
  const snapshot = row.value;
  const checksum = crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  const collections = {
    leads: mapValue(snapshot, "leads").size,
    people: mapValue(snapshot, "people").size,
    attempts: arrayValue(snapshot, "attempts").length,
    conversations: mapValue(snapshot, "conversations").size,
    events: arrayValue(snapshot, "events").length,
    fieldCandidates: arrayValue(snapshot, "fieldCandidates").length,
    leadFields: mapValue(snapshot, "leadFields").size,
  };
  console.log(JSON.stringify({ apply, revision: Number(row.revision ?? 0), updatedAt: row.updated_at, checksum, collections }, null, 2));
  if (!apply) process.exit(2);

  await client.query("BEGIN");
  try {
    for (const lead of mapValue(snapshot, "leads").values()) {
      await client.query(
        `INSERT INTO leads (id, public_ref, state, assigned_officer_id, borrower_timezone, data, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
         ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data, state=EXCLUDED.state, assigned_officer_id=EXCLUDED.assigned_officer_id, updated_at=EXCLUDED.updated_at`,
        [lead.id, lead.publicRef, lead.state, lead.assignedOfficerId ?? null, null, JSON.stringify(lead), iso(lead.createdAt), iso(lead.updatedAt)]
      );
    }
    for (const person of mapValue(snapshot, "people").values()) {
      await client.query(
        `INSERT INTO people (id, lead_id, role, phone_e164, email_normalized, data) VALUES ($1,$2,$3,$4,$5,$6::jsonb)
         ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data, phone_e164=EXCLUDED.phone_e164, email_normalized=EXCLUDED.email_normalized`,
        [person.id, person.leadId, person.role, person.phoneE164 ?? null, person.email?.toLowerCase() ?? null, JSON.stringify(person)]
      );
    }
    for (const attempt of arrayValue(snapshot, "attempts")) {
      await client.query(
        `INSERT INTO contact_attempts (id, lead_id, channel, direction, outcome, idempotency_key, provider_message_id, data, scheduled_for, started_at, ended_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)
         ON CONFLICT (id) DO UPDATE SET outcome=EXCLUDED.outcome, provider_message_id=EXCLUDED.provider_message_id, data=EXCLUDED.data, ended_at=EXCLUDED.ended_at`,
        [attempt.id, attempt.leadId, attempt.channel, attempt.direction, attempt.outcome, attempt.idempotencyKey, attempt.providerMessageId ?? null, JSON.stringify(attempt), iso(attempt.scheduledFor), attempt.startedAt ?? null, attempt.endedAt ?? null]
      );
    }
    for (const conversation of mapValue(snapshot, "conversations").values()) {
      await client.query(
        `INSERT INTO conversations (id, lead_id, contact_attempt_id, provider_call_id, status, prompt_version_id, profile_snapshot, context_snapshot, summary, action_items, data, started_at, ended_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10::jsonb,$11::jsonb,$12,$13)
         ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, summary=EXCLUDED.summary, action_items=EXCLUDED.action_items, data=EXCLUDED.data, ended_at=EXCLUDED.ended_at`,
        [conversation.id, conversation.leadId, conversation.contactAttemptId ?? null, conversation.providerCallId ?? null, conversation.status, conversation.promptVersionId, JSON.stringify(conversation.profileSnapshot ?? {}), JSON.stringify(conversation.contextSnapshot ?? {}), conversation.summary ?? null, JSON.stringify(conversation.actionItems ?? []), JSON.stringify(conversation), iso(conversation.startedAt), conversation.endedAt ?? null]
      );
      for (const turn of conversation.transcript ?? []) {
        await client.query(
          `INSERT INTO transcript_turns (conversation_id, turn, role, body, occurred_at) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (conversation_id, turn) DO UPDATE SET role=EXCLUDED.role, body=EXCLUDED.body, occurred_at=EXCLUDED.occurred_at`,
          [conversation.id, turn.turn, turn.role, turn.text, iso(turn.at)]
        );
      }
    }
    for (const event of arrayValue(snapshot, "events")) {
      await client.query(
        `INSERT INTO lead_events (id, lead_id, type, correlation_id, payload, occurred_at, recorded_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
         ON CONFLICT (id) DO NOTHING`,
        [event.id, event.leadId, event.type, event.correlationId, JSON.stringify(event.payload ?? {}), iso(event.occurredAt), iso(event.recordedAt)]
      );
    }
    for (const candidate of arrayValue(snapshot, "fieldCandidates")) {
      await client.query(
        `INSERT INTO field_candidates (id, lead_id, conversation_id, field_path, value, confidence, source_turns, review_status, reviewed_by, reviewed_at, created_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
        [candidate.id, candidate.leadId, candidate.sessionId ?? null, candidate.fieldPath, JSON.stringify(candidate.value ?? null), candidate.confidence, candidate.transcriptTurnRefs ?? [], candidate.reviewStatus ?? "PENDING", candidate.reviewedById ?? null, candidate.reviewedAt ?? null, iso(candidate.createdAt)]
      );
    }
    for (const field of mapValue(snapshot, "leadFields").values()) {
      await client.query(
        `INSERT INTO lead_fields (lead_id, field_path, value, data, updated_at) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5)
         ON CONFLICT (lead_id, field_path) DO UPDATE SET value=EXCLUDED.value, data=EXCLUDED.data, updated_at=EXCLUDED.updated_at`,
        [field.leadId, field.fieldPath, JSON.stringify(field.value ?? null), JSON.stringify(field), iso(field.collectedAt)]
      );
    }
    await client.query(
      `UPDATE system_settings SET admin_timezone=$1, timezone_confirmed=$2, settings=$3::jsonb, updated_at=now() WHERE id='main'`,
      [snapshot.config?.adminTimezone ?? "UTC", Boolean(snapshot.config?.timezoneConfirmed), JSON.stringify(snapshot.config ?? {})]
    );
    for (const note of arrayValue(snapshot, "notes")) {
      await client.query(
        `INSERT INTO notes (id, lead_id, author_id, author_name, body, created_at) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO NOTHING`,
        [note.id, note.leadId, note.authorId, note.authorName, note.body, iso(note.createdAt)]
      );
    }
    for (const task of mapValue(snapshot, "tasks").values()) {
      await client.query(
        `INSERT INTO tasks (id, lead_id, type, status, assignee_id, title, due_at, completed_at, data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT (id) DO NOTHING`,
        [task.id, task.leadId, task.type, task.status, task.assigneeId ?? null, task.title, iso(task.dueAt), task.completedAt ?? null, JSON.stringify(task)]
      );
    }
    for (const consent of arrayValue(snapshot, "consents")) {
      await client.query(
        `INSERT INTO consent_records (id, lead_id, person_id, scope, granted, disclosure_version_id, exact_text_snapshot, captured_at, source_url, ip_address, user_agent, data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) ON CONFLICT (id) DO NOTHING`,
        [consent.id, consent.leadId, consent.personId, consent.scope, consent.granted, consent.disclosureVersionId, consent.exactTextSnapshot, iso(consent.capturedAt), consent.sourceUrl, consent.ipAddress ?? null, consent.userAgent ?? null, JSON.stringify(consent)]
      );
    }
    for (const suppression of mapValue(snapshot, "suppressions").values()) {
      await client.query(
        `INSERT INTO suppressions (id, phone_e164, scope, channel, reason, created_at, expires_at, evidence_event_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [suppression.id, suppression.phoneE164, suppression.scope, suppression.channel ?? null, suppression.reason, iso(suppression.createdAt), suppression.expiresAt ?? null, suppression.evidenceEventId ?? null]
      );
    }
    for (const user of mapValue(snapshot, "users").values()) {
      await client.query(
        `INSERT INTO app_users (id, email_normalized, role, officer_id, active, password_hash, failed_login_attempts, locked_until, data, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) ON CONFLICT (id) DO NOTHING`,
        [user.id, user.email.toLowerCase(), user.role, user.officerId ?? null, user.isActive !== false, user.passwordHash ?? null, user.failedLoginAttempts ?? 0, user.lockedUntil ?? null, JSON.stringify({ ...user, passwordHash: undefined }), iso(user.createdAt)]
      );
    }
    for (const session of mapValue(snapshot, "sessions").values()) {
      const tokenHash = crypto.createHash("sha256").update(session.token).digest("hex");
      await client.query(
        `INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, idle_expires_at, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (token_hash) DO NOTHING`,
        [tokenHash, session.userId, iso(session.createdAt), iso(session.expiresAt), session.idleExpiresAt ?? null, session.lastSeenAt ?? null]
      );
    }
    for (const audit of arrayValue(snapshot, "auditLogs")) {
      await client.query(
        `INSERT INTO audit_logs (id, actor_id, actor_name, action, resource_type, resource_id, result, ip_address, correlation_id, metadata, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) ON CONFLICT (id) DO NOTHING`,
        [audit.id, audit.actorId, audit.actorName, audit.action, audit.resourceType, audit.resourceId, audit.result, audit.ipAddress ?? null, audit.metadata?.correlationId ?? null, JSON.stringify(audit.metadata ?? {}), iso(audit.at)]
      );
    }
    for (const credential of mapValue(snapshot, "credentials").values()) {
      await client.query(
        `INSERT INTO integration_credentials (key, encrypted_value, updated_at, updated_by_name)
         VALUES ($1,$2,$3,$4) ON CONFLICT (key) DO NOTHING`,
        [credential.key, credential.value, iso(credential.updatedAt), credential.updatedByName]
      );
    }
    for (const document of arrayValue(snapshot, "leadDocuments")) {
      await client.query(
        `INSERT INTO lead_documents (id, lead_id, filename, mime_type, size_bytes, object_key, category, uploaded_by, uploaded_at, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT (id) DO NOTHING`,
        [document.id, document.leadId, document.filename, document.mimeType, document.sizeBytes, document.storageRef ?? null, document.category, document.uploadedById, iso(document.uploadedAt), JSON.stringify({ uploadedByName: document.uploadedByName, signature: document.signature ?? null, requiresObjectMigration: Boolean(document.inlineContent && !document.storageRef) })]
      );
    }
    for (const item of arrayValue(snapshot, "inboundCallTriage")) {
      await client.query(
        `INSERT INTO inbound_call_triage (id, provider, provider_call_id, from_phone, reason, candidate_lead_ids, status, linked_lead_id, received_at, resolved_at, resolved_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
        [item.id, item.provider, item.providerCallId, item.fromPhone ?? null, item.reason, item.candidateLeadIds ?? [], item.status, item.linkedLeadId ?? null, iso(item.receivedAt), item.resolvedAt ?? null, item.resolvedBy ?? null]
      );
    }
    for (const context of mapValue(snapshot, "leadContextSnapshots").values()) {
      await client.query(
        `INSERT INTO lead_context_snapshots (id, lead_id, conversation_id, prompt_version_id, profile_version_id, snapshot, created_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT (id) DO UPDATE SET snapshot=EXCLUDED.snapshot`,
        [context.id, context.leadId, context.conversationId, context.promptVersionId, context.profileVersionId, JSON.stringify(context), iso(context.createdAt)]
      );
    }
    for (const progress of mapValue(snapshot, "qualificationProgress").values()) {
      for (const answer of progress.answers ?? []) {
        await client.query(
          `INSERT INTO qualification_answers (id, lead_id, conversation_id, question_id, field_path, value, confidence, source, transcript_turn_refs, conflict, captured_at)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11) ON CONFLICT (id) DO UPDATE SET value=EXCLUDED.value, confidence=EXCLUDED.confidence, conflict=EXCLUDED.conflict`,
          [answer.id, answer.leadId, answer.conversationId, answer.questionId, answer.fieldPath, JSON.stringify(answer.value ?? null), answer.confidence, answer.source, answer.transcriptTurnRefs ?? [], Boolean(answer.conflict), iso(answer.capturedAt)]
        );
      }
    }
    for (const decision of mapValue(snapshot, "qualificationDecisions").values()) {
      await client.query(
        `INSERT INTO qualification_decisions (conversation_id, lead_id, outcome, reason_codes, decided_at) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (conversation_id) DO UPDATE SET outcome=EXCLUDED.outcome, reason_codes=EXCLUDED.reason_codes, decided_at=EXCLUDED.decided_at`,
        [decision.conversationId, decision.leadId, decision.outcome, decision.reasonCodes ?? [], iso(decision.decidedAt)]
      );
    }
    for (const transfer of mapValue(snapshot, "transferAttempts").values()) {
      await client.query(
        `INSERT INTO transfer_attempts (id, lead_id, conversation_id, officer_id, destination_masked, status, provider_call_id, provider_transfer_id, consent_turn_ref, failure_reason, requested_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, failure_reason=EXCLUDED.failure_reason, updated_at=EXCLUDED.updated_at`,
        [transfer.id, transfer.leadId, transfer.conversationId, transfer.officerId ?? null, transfer.destinationMasked, transfer.status, transfer.providerCallId ?? null, transfer.providerTransferId ?? null, transfer.consentTurnRef ?? null, transfer.failureReason ?? null, iso(transfer.requestedAt), iso(transfer.updatedAt)]
      );
    }
    for (const appointment of mapValue(snapshot, "callbackAppointments").values()) {
      await client.query(
        `INSERT INTO callback_appointments (id, lead_id, officer_id, source_conversation_id, transfer_attempt_id, starts_at, ends_at, borrower_timezone, status, consent_record_id, cancellation_reason, provider_correlation_ids, confirmation_attempt_id, reminder_attempt_id, created_at, updated_at, cancelled_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, cancellation_reason=EXCLUDED.cancellation_reason, provider_correlation_ids=EXCLUDED.provider_correlation_ids, updated_at=EXCLUDED.updated_at`,
        [appointment.id, appointment.leadId, appointment.officerId ?? null, appointment.sourceConversationId ?? null, appointment.transferAttemptId ?? null, iso(appointment.startsAt), iso(appointment.endsAt), appointment.borrowerTimezone, appointment.status, appointment.consentRecordId ?? null, appointment.cancellationReason ?? null, appointment.providerCorrelationIds ?? [], appointment.confirmationAttemptId ?? null, appointment.reminderAttemptId ?? null, iso(appointment.createdAt), iso(appointment.updatedAt), appointment.cancelledAt ?? null]
      );
    }
    for (const connection of mapValue(snapshot, "redditConnections").values()) {
      await client.query(
        `INSERT INTO reddit_connections (id, account_name, encrypted_refresh_token, scopes, connected_by_id, connected_at, revoked_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO UPDATE SET revoked_at=EXCLUDED.revoked_at`,
        [connection.id, connection.accountName, connection.encryptedRefreshToken, connection.scopes ?? [], connection.connectedById, iso(connection.connectedAt), connection.revokedAt ?? null]
      );
    }
    for (const publication of mapValue(snapshot, "redditPublications").values()) {
      await client.query(
        `INSERT INTO reddit_publications (id, signal_id, final_text, approved_by_id, approved_by_name, subreddit_rules_confirmed, idempotency_key, status, reddit_comment_id, permalink, provider_response, created_at, published_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13) ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, reddit_comment_id=EXCLUDED.reddit_comment_id, permalink=EXCLUDED.permalink, provider_response=EXCLUDED.provider_response, published_at=EXCLUDED.published_at`,
        [publication.id, publication.signalId, publication.finalText, publication.approvedById, publication.approvedByName, publication.subredditRulesConfirmed, publication.idempotencyKey, publication.status, publication.redditCommentId ?? null, publication.permalink ?? null, JSON.stringify(publication.providerResponse ?? {}), iso(publication.createdAt), publication.publishedAt ?? null]
      );
    }
    for (const health of mapValue(snapshot, "integrationHealth").values()) {
      await client.query(
        `INSERT INTO integration_health_checks (integration_id, ok, message, verified_at, verified_by_id, verified_by_name)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (integration_id) DO UPDATE SET ok=EXCLUDED.ok, message=EXCLUDED.message, verified_at=EXCLUDED.verified_at, verified_by_id=EXCLUDED.verified_by_id, verified_by_name=EXCLUDED.verified_by_name`,
        [health.integrationId, health.ok, health.message, iso(health.verifiedAt), health.verifiedById, health.verifiedByName]
      );
    }
    for (const session of mapValue(snapshot, "dialingSessions").values()) {
      await client.query(
        `INSERT INTO dialing_sessions (id, name, mode, status, created_by_id, created_by_name, current_item_id, created_at, updated_at, completed_at, cancelled_at)
         VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, status=EXCLUDED.status, updated_at=EXCLUDED.updated_at, completed_at=EXCLUDED.completed_at, cancelled_at=EXCLUDED.cancelled_at`,
        [session.id, session.name, session.mode, session.status, session.createdById, session.createdByName, iso(session.createdAt), iso(session.updatedAt), session.completedAt ?? null, session.cancelledAt ?? null]
      );
    }
    for (const item of mapValue(snapshot, "dialingQueueItems").values()) {
      await client.query(
        `INSERT INTO dialing_queue_items (id, session_id, lead_id, position, status, attempt_id, conversation_id, reason, started_at, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, attempt_id=EXCLUDED.attempt_id, conversation_id=EXCLUDED.conversation_id, reason=EXCLUDED.reason, started_at=EXCLUDED.started_at, completed_at=EXCLUDED.completed_at`,
        [item.id, item.sessionId, item.leadId, item.position, item.status, item.attemptId ?? null, item.conversationId ?? null, item.reason ?? null, item.startedAt ?? null, item.completedAt ?? null]
      );
    }
    for (const session of mapValue(snapshot, "dialingSessions").values()) {
      if (session.currentItemId) await client.query("UPDATE dialing_sessions SET current_item_id=$2 WHERE id=$1", [session.id, session.currentItemId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }

  const verified = {
    leads: Number((await client.query("SELECT count(*)::int AS count FROM leads")).rows[0].count),
    people: Number((await client.query("SELECT count(*)::int AS count FROM people")).rows[0].count),
    attempts: Number((await client.query("SELECT count(*)::int AS count FROM contact_attempts")).rows[0].count),
    conversations: Number((await client.query("SELECT count(*)::int AS count FROM conversations")).rows[0].count),
  };
  for (const key of Object.keys(verified)) {
    if (verified[key] < collections[key]) throw new Error(`Normalized reconciliation count is below the snapshot count for ${key}`);
  }
  console.log(JSON.stringify({ migrated: true, checksum, expected: collections, verified }, null, 2));
} finally {
  await client.end();
}
